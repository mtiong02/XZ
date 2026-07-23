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

/** 面向用户的紧凑数量：大于等于 1000 克/毫升时使用更易读的公制单位。 */
export function formatInventoryQuantity(quantity: string | number, unit: string): string {
  const numeric = Number(quantity);
  const compact = (value: number) =>
    Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?(0+)$/, '');
  if (Number.isFinite(numeric) && unit === 'g' && numeric >= 1000) {
    return `${compact(numeric / 1000)}kg`;
  }
  if (Number.isFinite(numeric) && unit === 'ml' && numeric >= 1000) {
    return `${compact(numeric / 1000)}L`;
  }
  if (unit === 'kg') return `${quantity}kg`;
  if (unit === 'l') return `${quantity}L`;
  return `${quantity} ${unitLabel(unit)}`;
}

const FOOD_CATEGORY_LABELS: Record<string, string> = {
  VEGETABLE: '蔬菜',
  FRUIT: '水果',
  MEAT: '肉类',
  SEAFOOD: '水产',
  AQUATIC: '水产',
  EGG_DAIRY: '蛋奶',
  DAIRY: '乳制品',
  GRAIN: '主食',
  STAPLE: '主食',
  GRAIN_STAPLE: '主食',
  BEVERAGE: '饮料',
  SOFT_DRINK: '饮料',
  CONDIMENT: '调味料',
  SNACK: '零食',
};

export function foodCategoryLabel(category: string, categoryCode?: string): string {
  return FOOD_CATEGORY_LABELS[categoryCode ?? ''] ?? FOOD_CATEGORY_LABELS[category] ?? '其他';
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

export function formatExpiryRelative(iso: string | null): string {
  if (!iso) return '无到期日';
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return '到期日未知';
  const days = Math.ceil((timestamp - Date.now()) / (24 * 60 * 60 * 1000));
  const absoluteDays = Math.abs(days);
  const relative = (value: number) => {
    if (value <= 7) return `${value}天`;
    if (value <= 28) return `${Math.ceil(value / 7)}周`;
    if (value <= 365) return `${Math.ceil(value / 30)}个月`;
    return `${Math.ceil(value / 365)}年`;
  };
  if (days > 0) return `${relative(days)}后到期`;
  if (days === 0) return '今天到期';
  return `已过期${relative(absoluteDays)}`;
}

/** 超过半年仍保留信息，但降低视觉强调，不视为临期提醒。 */
export function isExpiryLongHorizon(iso: string | null): boolean {
  if (!iso) return false;
  const timestamp = new Date(iso).getTime();
  return Number.isFinite(timestamp) && timestamp - Date.now() > 180 * 24 * 60 * 60 * 1000;
}

export const TRANSACTION_LABEL: Record<string, string> = {
  ADD: '添加',
  CONSUME: '使用',
  DISCARD: '丢弃',
  CORRECT: '修正',
  MOVE: '移动',
  REVERSAL: '撤销',
};
