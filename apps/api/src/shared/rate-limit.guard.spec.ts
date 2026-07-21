import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { WriteRateLimitGuard } from './rate-limit.guard';

function contextFor(userId: string): ExecutionContext {
  const request = {
    user: { userId },
    method: 'POST',
    route: { path: '/commands' },
    url: '/commands',
    ip: '127.0.0.1',
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('WriteRateLimitGuard', () => {
  it('allows requests under the limit and blocks the 31st within the window', () => {
    const guard = new WriteRateLimitGuard();
    const ctx = contextFor('user-a');
    for (let i = 0; i < 30; i += 1) {
      expect(guard.canActivate(ctx)).toBe(true);
    }
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
  });

  it('isolates limits per user', () => {
    const guard = new WriteRateLimitGuard();
    const a = contextFor('user-a');
    const b = contextFor('user-b');
    for (let i = 0; i < 30; i += 1) guard.canActivate(a);
    // user-b unaffected by user-a hitting the cap
    expect(guard.canActivate(b)).toBe(true);
  });
});
