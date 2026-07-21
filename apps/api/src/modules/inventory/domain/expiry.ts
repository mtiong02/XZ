/**
 * 临期状态计算（docs/01 FR-012、docs/04 Sprint 5）。
 * 确定性规则，不依赖 AI：
 * - EXPIRED：已过到期时间；
 * - EXPIRING：距到期 <= 阈值天数（默认 2 天）；
 * - NORMAL：其余有到期日的；
 * - UNKNOWN：无到期日。
 */

export type ExpiryStatus = 'NORMAL' | 'EXPIRING' | 'EXPIRED' | 'UNKNOWN';

export const DEFAULT_EXPIRING_THRESHOLD_DAYS = 2;

export function computeExpiryStatus(
  expiresAt: Date | null,
  now: Date,
  thresholdDays: number = DEFAULT_EXPIRING_THRESHOLD_DAYS,
): ExpiryStatus {
  if (expiresAt === null) return 'UNKNOWN';
  if (expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  const msLeft = expiresAt.getTime() - now.getTime();
  if (msLeft <= thresholdDays * 24 * 60 * 60 * 1000) return 'EXPIRING';
  return 'NORMAL';
}
