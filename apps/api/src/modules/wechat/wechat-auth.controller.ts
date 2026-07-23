import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WechatAuthService } from './wechat-auth.service';

@Controller('auth/wechat')
export class WechatAuthController {
  constructor(private readonly auth: WechatAuthService) {}

  @Get('status')
  status() {
    return { enabled: this.auth.isConfigured() };
  }

  @Get('start')
  start(@Res() response: Response) {
    response.redirect(302, this.auth.start());
  }

  @Get('callback')
  async callback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Res() response: Response) {
    if (!code || !state) return response.redirect(302, 'https://busybeeenglish.site/login?wechat_error=missing_params');
    try {
      response.redirect(302, await this.auth.complete(code, state));
    } catch (error) {
      const message = error instanceof Error ? error.message : '微信登录失败，请重试。';
      const url = new URL('https://busybeeenglish.site/login');
      url.searchParams.set('wechat_error', message.slice(0, 120));
      response.redirect(302, url.toString());
    }
  }
}
