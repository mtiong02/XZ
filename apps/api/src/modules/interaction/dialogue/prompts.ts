import { unitSpokenLabel } from './units-spoken';

/**
 * 系统播报文案生成（会被前端 Kokoro TTS 合成为语音）。
 * 面向听觉：短句、口语化、数量带量词。
 *
 * v2: 多食材分组播报、数量=1 省略、错误恢复文案、操作后追问。
 */

export interface SpokenItem {
  food_name: string;
  quantity: string;
  unit: string;
}

const ACTION_VERB: Record<string, string> = {
  ADD_INVENTORY: '添加',
  CONSUME_INVENTORY: '用掉',
  DISCARD_INVENTORY: '丢弃',
  MOVE_INVENTORY: '移动',
};

/**
 * 口语化列举食材：数量为 1 时省略数字（"加个苹果" 而非 "加1个苹果"），
 * 更自然亲切。
 */
function listItems(items: SpokenItem[]): string {
  return items
    .map((item) => {
      const qty = item.quantity === '1' ? '' : item.quantity;
      return `${qty}${unitSpokenLabel(item.unit)}${item.food_name}`;
    })
    .join('、');
}

/** 确认播报：单食材简洁、多食材分组 */
export function confirmPrompt(commandType: string, items: SpokenItem[]): string {
  const verb = ACTION_VERB[commandType] ?? '记录';
  if (items.length <= 3) {
    return `确认${verb}${listItems(items)}？`;
  }
  // 超过 3 样时分组播报
  const summary = items
    .map((i) => {
      const qty = i.quantity === '1' ? '' : i.quantity;
      return `${i.food_name}${qty}${unitSpokenLabel(i.unit)}`;
    })
    .join('、');
  return `确认${verb}${items.length}样：${summary}，是吗？`;
}

/** 追问播报（缺数量）：\"请问添加多少牛奶?\" */
export function clarifyQuantityPrompt(
  commandType: string,
  foodName: string,
  // 零拦截策略下不再向用户罗列\"建议单位\"（会诱导口头换算），保留参数以兼容调用方
  _suggestedUnits: string[] = [],
): string {
  const verb = ACTION_VERB[commandType] ?? '记录';
  return `请问${verb}多少${foodName}？`;
}

export function clarifyUnitPrompt(
  foodName: string,
  quantity: string,
  unit: string,
  _suggestedUnits: string[],
): string {
  return `${foodName}是${quantity}${unitSpokenLabel(unit)}吗？或直接说正确数量。`;
}

/** 修正被采纳后重新确认 */
export function correctedPrompt(commandType: string, items: SpokenItem[]): string {
  return `改成${listItems(items)}，是吗？`;
}

export function executedPrompt(commandType: string): string {
  const verb = ACTION_VERB[commandType] ?? '记录';
  return `好的，已${verb}。还有其他要处理的吗？`;
}

/** 领域错误的友好播报文案 */
export function domainErrorPrompt(errorCode: string, details?: Record<string, unknown>): string {
  switch (errorCode) {
    case 'INVENTORY_INSUFFICIENT':
      return `库存不足，当前只有${details?.available ?? '?'}${unitSpokenLabel((details?.unit as string) ?? '')}，是要全部用掉吗？`;
    case 'UNIT_MISMATCH':
      return `单位不匹配，目前记录的是${unitSpokenLabel((details?.from_unit as string) ?? '')}，请确认您的单位。`;
    case 'FOOD_NOT_FOUND':
      return '这种食材还没有收录。你可以直接说名称和数量，我帮你创建。';
    default:
      return `执行失败：请重新告诉我数量或修改操作。`;
  }
}

export const CANCELLED_PROMPT = '已取消。';
export const UNCLEAR_PROMPT = '没听清，请说"对"或直接说数量。';
export const UNRECOGNIZED_PROMPT = '没完全听懂。你可以说"查库存"、"推荐晚餐"或"添加猪肉"。';
