import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../modules/auth/auth.guard';

/**
 * 轻量内存滑动窗口限流（docs/04 Sprint 6 安全测试：速率限制）。
 * 按 用户 + 方法+路径 维度限流，防止重放和滥用放大。
 * MVP 单实例足够；多实例部署时改为共享存储（Redis）——届时再引入基础设施（AGENTS.md §6）。
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 10_000;
const MAX_WRITES_PER_WINDOW = 30;

@Injectable()
export class WriteRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // 认证守卫已运行，user 存在；无 user 时退化为按 IP
    const identity = request.user?.userId ?? request.ip ?? 'anonymous';
    const key = `${identity}:${request.method}:${request.route?.path ?? request.url}`;
    const now = Date.now();

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      this.evictExpired(now);
      return true;
    }
    if (bucket.count >= MAX_WRITES_PER_WINDOW) {
      throw new HttpException(
        {
          type: 'https://xz.app/errors/rate-limited',
          title: 'Too many requests',
          status: 429,
          code: 'RATE_LIMITED',
          detail: 'Please slow down and retry shortly.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    bucket.count += 1;
    return true;
  }

  private evictExpired(now: number): void {
    if (this.buckets.size < 10_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
