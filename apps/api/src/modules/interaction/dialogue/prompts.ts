import { unitSpokenLabel } from './units-spoken';

/**
 * 系统播报文案生成（会被前端 Kokoro TTS 合成为语音）。
 * 面向听觉：短句、口语化、数量带量词。
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

function listItems(items: SpokenItem[]): string {
  return items
    .map((item) => `${item.quantity}${unitSpokenLabel(item.unit)}${item.food_name}`)
    .join('、');
}

/** 确认播报："确认添加两盒牛奶、十个鸡蛋？" */
export function confirmPrompt(commandType: string, items: SpokenItem[]): string {
  const verb = ACTION_VERB[commandType] ?? '记录';
  return `确认${verb}${listItems(items)}？`;
}

/** 追问播报（缺数量）："请问添加多少牛奶?" */
export function clarifyQuantityPrompt(
  commandType: string,
  foodName: string,
  suggestedUnits: string[] = [],
): string {
  const verb = ACTION_VERB[commandType] ?? '记录';
  return `请问${verb}多少${foodName}？`;
}

export function clarifyUnitPrompt(
  foodName: string,
  quantity: string,
  unit: string,
  suggestedUnits: string[],
): string {
  return `${foodName}是${quantity}${unitSpokenLabel(unit)}吗？或直接说正确数量。`;
}

function unitChoices(units: string[]): string {
  return units.slice(0, 3).map(unitSpokenLabel).join('、');
}

/** 修正被采纳后重新确认 */
export function correctedPrompt(commandType: string, items: SpokenItem[]): string {
  return `改成${listItems(items)}，是吗？`;
}

export function executedPrompt(commandType: string): string {
  const verb = ACTION_VERB[commandType] ?? '记录';
  return `好的，已${verb}。`;
}

export const CANCELLED_PROMPT = '已取消。';
export const UNCLEAR_PROMPT = '没听清，请说“对”或直接说数量。';
export const UNRECOGNIZED_PROMPT =
  '没完全听懂。你可以说“查库存”、“推荐晚餐”或“添加猪肉”。';
