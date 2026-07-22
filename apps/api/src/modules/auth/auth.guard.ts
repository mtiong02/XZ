import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ENV, type Env } from '../../config/env';

export interface AuthenticatedUser {
  userId: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

interface CacheEntry {
  userId: string;
  expiresAt: number;
}

const TOKEN_CACHE_TTL_MS = 60_000;
const TOKEN_CACHE_MAX = 1000;

/**
 * 认证：将 Bearer token 交给 Supabase GoTrue 校验（支持 ES256/HS256，算法无关）。
 * 结果短期缓存以满足写入延迟预算（NFR-002）。
 * 授权（household membership）在应用服务层单独校验。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(@Inject(ENV) private readonly env: Env) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length);

    const cached = this.cache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      request.user = { userId: cached.userId };
      return true;
    }

    const userId = await this.introspect(token);
    if (this.cache.size >= TOKEN_CACHE_MAX) {
      this.cache.clear();
    }
    this.cache.set(token, { userId, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
    request.user = { userId };
    return true;
  }

  private async introspect(token: string): Promise<string> {
    if (!this.env.SUPABASE_URL || !this.env.SUPABASE_ANON_KEY) {
      throw new UnauthorizedException('Auth provider not configured');
    }
    const baseUrl = this.env.SUPABASE_URL.replace(/\/$/, '');
    const userUrl = baseUrl.endsWith('/auth/v1') ? `${baseUrl}/user` : `${baseUrl}/auth/v1/user`;
    const directUrl = `${baseUrl}/user`;

    let response: Response;
    try {
      response = await fetch(userUrl, {
        headers: {
          apikey: this.env.SUPABASE_ANON_KEY,
          authorization: `Bearer ${token}`,
        },
      });
      if (response.status === 404 && userUrl !== directUrl) {
        response = await fetch(directUrl, {
          headers: {
            apikey: this.env.SUPABASE_ANON_KEY,
            authorization: `Bearer ${token}`,
          },
        });
      }
    } catch {
      throw new UnauthorizedException('Auth provider unreachable');
    }
    if (!response.ok) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const body = (await response.json()) as { id?: string };
    if (typeof body.id !== 'string' || body.id.length === 0) {
      throw new UnauthorizedException('Invalid token subject');
    }
    return body.id;
  }
}
