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

/** 确认播报："你是说，添加两盒牛奶、十个鸡蛋，对吗?" */
export function confirmPrompt(commandType: string, items: SpokenItem[]): string {
  const verb = ACTION_VERB[commandType] ?? '记录';
  return `你是说，${verb}${listItems(items)}，对吗？`;
}

/** 追问播报（缺数量）："请问要添加多少牛奶?" */
export function clarifyQuantityPrompt(
  commandType: string,
  foodName: string,
  suggestedUnits: string[] = [],
): string {
  const verb = ACTION_VERB[commandType] ?? '记录';
  const choices = unitChoices(suggestedUnits);
  return choices
    ? `${foodName}可以按${choices}记录。请问要${verb}多少？`
    : `请问要${verb}多少${foodName}？`;
}

export function clarifyUnitPrompt(
  foodName: string,
  quantity: string,
  unit: string,
  suggestedUnits: string[],
): string {
  return `${foodName}通常按${unitChoices(suggestedUnits)}记录。你说的是${quantity}${unitSpokenLabel(unit)}吗？请直接说正确的数量和单位。`;
}

function unitChoices(units: string[]): string {
  return units.slice(0, 3).map(unitSpokenLabel).join('、');
}

/** 修正被采纳后重新确认 */
export function correctedPrompt(commandType: string, items: SpokenItem[]): string {
  return `好的，改成${listItems(items)}，对吗？`;
}

export function executedPrompt(commandType: string): string {
  const verb = ACTION_VERB[commandType] ?? '记录';
  return `好的，已${verb}。`;
}

export const CANCELLED_PROMPT = '好的，已取消。';
export const UNCLEAR_PROMPT = '抱歉没听清，请说"对"确认，或直接说正确的数量。';
export const UNRECOGNIZED_PROMPT =
  '我没完全听明白。你可以直接说查库存、推荐一餐、设置提醒，或添加、使用、移动食材；例如“推荐一份少油晚餐”或“把猪肉移到冷冻室”。';
