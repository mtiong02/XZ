import type { ExpiryStatus } from '@xz/contracts';

export const EXPIRY_LABEL: Record<ExpiryStatus, string> = {
  NORMAL: '新鲜',
  EXPIRING: '临期',
  EXPIRED: '已过期',
  UNKNOWN: '无到期日',
};

export const EXPIRY_CLASS: Record<ExpiryStatus, string> = {
  NORMAL: 'normal',
  EXPIRING: 'expiring',
  EXPIRED: 'expired',
  UNKNOWN: 'unknown',
};

export const UNIT_LABEL: Record<string, string> = {
  piece: '个',
  box: '盒',
  bottle: '瓶',
  pack: '包',
  bag: '袋',
  bunch: '把',
  jin: '斤',
  g: '克',
  kg: '千克',
  ml: '毫升',
  l: '升',
};

export function unitLabel(code: string): string {
  return UNIT_LABEL[code] ?? code;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export const TRANSACTION_LABEL: Record<string, string> = {
  ADD: '添加',
  CONSUME: '使用',
  DISCARD: '丢弃',
  CORRECT: '修正',
  MOVE: '移动',
  REVERSAL: '撤销',
};
