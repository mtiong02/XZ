import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { ENV, type Env } from '../../config/env';
import { PG_POOL } from '../../infra/db/database.module';

type WechatState = { createdAt: number; redirectTo: string };
type WechatToken = {
  access_token?: string;
  openid?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
};
type WechatProfile = { nickname?: string; headimgurl?: string; unionid?: string; openid?: string };

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_STATES = 1000;

@Injectable()
export class WechatAuthService {
  private readonly states = new Map<string, WechatState>();

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(ENV) private readonly env: Env,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.env.WECHAT_APP_ID && this.env.WECHAT_APP_SECRET && this.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  }

  start(): string {
    const config = this.requireConfigured();
    this.pruneStates();
    const state = randomBytes(24).toString('hex');
    this.states.set(state, { createdAt: Date.now(), redirectTo: this.env.WECHAT_SITE_URL });
    const params = new URLSearchParams({
      appid: config.appId,
      redirect_uri: this.env.WECHAT_AUTH_CALLBACK_URL,
      response_type: 'code',
      scope: 'snsapi_login',
      state,
    });
    return `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}#wechat_redirect`;
  }

  async complete(code: string, state: string): Promise<string> {
    const config = this.requireConfigured();
    const pending = this.states.get(state);
    this.states.delete(state);
    if (!pending || Date.now() - pending.createdAt > STATE_TTL_MS) {
      throw new Error('微信登录状态已过期，请重新扫码。');
    }

    const tokenParams = new URLSearchParams({
      appid: config.appId,
      secret: config.appSecret,
      code,
      grant_type: 'authorization_code',
    });
    const token = await this.fetchJson<WechatToken>(
      `https://api.weixin.qq.com/sns/oauth2/access_token?${tokenParams.toString()}`,
    );
    if (!token.openid || !token.access_token) throw new Error(token.errmsg || '微信授权失败。');

    let profile: WechatProfile = token.unionid
      ? { openid: token.openid, unionid: token.unionid }
      : { openid: token.openid };
    try {
      const profileParams = new URLSearchParams({
        access_token: token.access_token,
        openid: token.openid,
        lang: 'zh_CN',
      });
      profile = {
        ...profile,
        ...(await this.fetchJson<WechatProfile>(
          `https://api.weixin.qq.com/sns/userinfo?${profileParams.toString()}`,
        )),
      };
    } catch {
      // 用户资料不是登录的必要条件；微信部分应用不会返回头像/昵称。
    }

    const identity = await this.findOrCreateIdentity(profile);
    const auth = await this.signIn(identity.email, identity.password);
    const redirect = new URL(pending.redirectTo);
    redirect.hash = new URLSearchParams({
      access_token: auth.access_token,
      refresh_token: auth.refresh_token,
      expires_in: String(auth.expires_in ?? 3600),
      token_type: 'bearer',
      provider: 'wechat',
    }).toString();
    return redirect.toString();
  }

  private async findOrCreateIdentity(
    profile: WechatProfile,
  ): Promise<{ email: string; password: string }> {
    const config = this.requireConfigured();
    const openId = profile.openid;
    if (!openId) throw new Error('微信授权返回缺少 openid，无法建立登录身份。');
    const unionId = profile.unionid || null;
    const existing = (
      await this.pool.query<{ user_id: string }>(
        `select user_id from wechat_identities where open_id = $1 or ($2::text is not null and union_id = $2) limit 1`,
        [openId, unionId],
      )
    ).rows[0];

    // 以当前网站应用的 openid 作为稳定的登录密钥；unionid 只用于跨应用去重。
    const identityKey = openId;
    const email = `wx_${createHash('sha256').update(identityKey).digest('hex').slice(0, 32)}@wechat.xz.internal`;
    // 仅用于桥接到现有 GoTrue password token 接口；不回传、不写入业务库。
    const password = createHmac('sha256', config.appSecret).update(identityKey).digest('hex');

    if (!existing) {
      const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: config.serviceRoleKey,
          authorization: `Bearer ${config.serviceRoleKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            display_name: profile.nickname || '微信用户',
            avatar_url: profile.headimgurl || null,
          },
          app_metadata: { provider: 'wechat' },
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`微信账号创建失败：${body.slice(0, 160)}`);
      }
      const created = (await response.json()) as { id?: string };
      if (!created.id) throw new Error('微信账号创建失败。');
      await this.pool.query(
        `insert into wechat_identities (user_id, open_id, union_id, nickname, avatar_url)
         values ($1, $2, $3, $4, $5)`,
        [created.id, openId, unionId, profile.nickname || null, profile.headimgurl || null],
      );
    }
    return { email, password };
  }

  private async signIn(
    email: string,
    password: string,
  ): Promise<{ access_token: string; refresh_token: string; expires_in?: number }> {
    const config = this.requireConfigured();
    const response = await fetch(
      `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: { apikey: config.anonKey, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      },
    );
    if (!response.ok) throw new Error('微信会话创建失败，请稍后重试。');
    return (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in?: number;
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) throw new Error('微信服务暂时不可用。');
    return (await response.json()) as T;
  }

  /**
   * 校验并返回收窄后的配置。返回值让调用方直接使用已确认存在的密钥，
   * 避免非空断言绕过校验（AGENTS.md §4：禁止无理由的类型逃逸）。
   */
  private requireConfigured(): {
    appId: string;
    appSecret: string;
    supabaseUrl: string;
    serviceRoleKey: string;
    anonKey: string;
  } {
    const {
      WECHAT_APP_ID: appId,
      WECHAT_APP_SECRET: appSecret,
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      SUPABASE_ANON_KEY: anonKey,
    } = this.env;
    if (!appId || !appSecret || !supabaseUrl || !serviceRoleKey || !anonKey) {
      throw new ServiceUnavailableException('微信授权登录尚未配置 AppID、AppSecret 或服务端密钥。');
    }
    return { appId, appSecret, supabaseUrl, serviceRoleKey, anonKey };
  }

  private pruneStates() {
    const cutoff = Date.now() - STATE_TTL_MS;
    for (const [state, item] of this.states) if (item.createdAt < cutoff) this.states.delete(state);
    if (this.states.size >= MAX_PENDING_STATES) this.states.clear();
  }
}
