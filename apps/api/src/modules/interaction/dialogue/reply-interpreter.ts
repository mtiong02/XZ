import { normalizeTranscript } from '../parser/normalizer';
import {
  extractCorrectionQuantity,
  parseTranscript,
  type FoodCatalogEntry,
  type ParsedItem,
} from '../parser/intent-parser';

/**
 * 确认轮回复解析（多轮语音对话）。
 *
 * 当系统播报"你是说…对吗?"后，用户的口头回复分四类：
 * - CONFIRM   ：对/是的/没错/确认…            -> 执行候选命令
 * - REJECT    ：不对/取消/算了…（无新数值）    -> 取消
 * - CORRECTION：不是两盒是三盒 / 改成三盒 / 是三个鸡蛋（带新数量或食材）-> 更新候选后重新确认
 * - UNCLEAR   ：都不匹配                        -> 追问
 *
 * 全部确定性规则，可回归测试；不让模型决定库存事实（docs/07 §9）。
 */

export type ReplyInterpretation =
  | { kind: 'CONFIRM' }
  | { kind: 'REJECT' }
  | {
      kind: 'CORRECTION';
      items: ParsedItem[];
      hasFood: boolean;
      /** 无食材的裸数量修正（"改成三盒"），取修正目标（最后一个数量）。 */
      bareQuantity: { quantity: string; unit: string } | null;
    }
  | { kind: 'UNCLEAR' };

const CONFIRM_PATTERN =
  /^(?:(?:是的?|对的?|确认|没错|好的|可以|嗯|行|ok|yes|correct|right|yep|sure|是|对))+$/i;
const REJECT_PATTERN =
  /(不对|不是的|不要|取消|算了|错了|不用了|重来|结束|退出|不用|多谢|就这|算了吧|不加了|不做|no|cancel|wrong|nope)/i;

/** 相对库存数量。当前先支持最常见且无歧义的“一半”。 */
export function relativeInventoryFraction(rawReply: string): string | null {
  const normalized = normalizeTranscript(rawReply);
  return /一半|半数|0\.5数?|百分之50|50%/.test(normalized) ? '0.5' : null;
}

import { isPhoneticallyExit } from './phonetic-matcher';

/** 明确结束当前会话；使用拼音音元智能匹配 + 容错识别 ASR 错别字（如“结束兑换”），但不误伤“结束后提醒我”。 */
export function isDialogueExit(rawReply: string): boolean {
  const compact = rawReply.replace(/[\s，。！？、,.!?：:；;“”‘’'"`]/g, '');
  if (/结束后提醒/.test(compact)) return false;

  // 优先进行拼音音元智能匹配 (支持近音字、错别字及重复短语)
  if (isPhoneticallyExit(compact)) return true;

  const courtesy = '(?:谢谢(?:你|啦)?|多谢|辛苦了|麻烦你了|拜拜|再见|晚安|了|吧)*';
  
  // 1. 如果整个词是由重复的“结束对话/结束兑换/结束对换/结束通话/拜拜/退下”组成的，直接返回 true
  if (/^(?:(?:好(?:的)?)?(?:结束|退出|关闭|停止|取消|拜拜|再见|退下)(?:这段|本次|当前)?(?:对话|对换|兑换|绘话|会话|聊天|谈话|通话|对|聊|会|吧|了|谢谢)*)+$/i.test(compact)) {
    return true;
  }

  return (
    new RegExp(
      `^(?:好(?:的)?|那|嗯|啊|行|可以)?(?:我(?:们)?(?:要|想|先)?|请)?(?:(?:结束|退出|关闭|停止)(?:这段|本次|当前)?(?:对话|对换|兑换|绘话|会话|聊天|谈话|通话|对|聊|会)?${courtesy})+$`,
      'i',
    ).test(compact) ||
    new RegExp(
      `^(?:好(?:的)?|那|嗯|啊|行|可以)?(?:(?:我们|咱们|我)(?:今天)?(?:就|先)?|今天)?(?:就|先)?(?:先这样|就这样|到这(?:里)?|先到这(?:里)?|没事了|没有别的了|不聊了|下次再聊|回头再聊|我先走了|我先忙了|先挂了|挂了|结束吧|退下吧|先退下|你先退下|拜拜|再见|晚安)${courtesy}$`,
      'i',
    ).test(compact) ||
    new RegExp(
      `^(?:好(?:的)?|那|嗯|啊)?(?:(?:先)?(?:别|不要|不用)(?:再|继续)?(?:听|收音|说|说话|聊天|聊|回答|播报)|(?:不用|不需要)再(?:听|收音|说|说话|聊天|聊|回答|播报))${courtesy}$`,
      'i',
    ).test(compact) ||
    new RegExp(`^(?:好(?:的)?)?(?:谢谢(?:你|啦)?|多谢)?(?:结束|退出)${courtesy}$`, 'i').test(compact) ||
    new RegExp(`^(?:结束|退出|取消|算了|不用了|不加了)(?:对话|会话|对换|聊天|谈话|通话|谢谢|吧|了)?${courtesy}$`, 'i').test(compact)
  );
}

/**
 * 探测回复中是否携带"新数量/新食材"——这类回复即便含"不"字也是修正而非纯拒绝。
 * 复用意图解析器的食材/数量抽取。
 */
export function interpretReply(rawReply: string, catalog: FoodCatalogEntry[]): ReplyInterpretation {
  if (isDialogueExit(rawReply)) return { kind: 'REJECT' };
  const normalized = normalizeTranscript(rawReply);

  // 1. 先看是否是携带新值的修正（"不是两盒是三盒"里的"三盒"）
  const parsed = parseTranscript(normalized, catalog);
  const hasNewFood = parsed.items.length > 0;
  const hasBareQuantity = BARE_QUANTITY_PATTERN.test(normalized);

  if (hasNewFood || hasBareQuantity) {
    // 纯确认词误伤保护：如果整句其实是"对"，parseTranscript 不会出食材，也无裸数量，走不到这里
    return {
      kind: 'CORRECTION',
      items: parsed.items,
      hasFood: hasNewFood,
      bareQuantity: hasNewFood ? null : extractCorrectionQuantity(normalized),
    };
  }

  // 2. 无新值：判断确认 / 拒绝
  if (REJECT_PATTERN.test(normalized)) return { kind: 'REJECT' };
  if (CONFIRM_PATTERN.test(normalized.trim())) return { kind: 'CONFIRM' };

  return { kind: 'UNCLEAR' };
}

// 裸数量+单位（无食材词），如"三盒"、"3个"、"改成两瓶"
const BARE_QUANTITY_PATTERN =
  /\d+(?:\.\d+)?\s*(千克|公斤|毫升|克|盒|瓶|包|袋|把|个|只|颗|枚|根|片|块|段|斤|升|kg|ml|g|l)/i;
