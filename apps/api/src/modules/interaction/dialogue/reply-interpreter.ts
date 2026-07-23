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

// 真实口语通常不会只说一个“对”："可以的"、"没问题"、"是的帮我添加"、
// 以及 ASR 偶尔多出的语气字（"是的准"）都应视为确认，而不是让用户重说。
const CONFIRM_PATTERN =
  /^(?:(?:是的?|对的?|确认|没错|好的?|可以(?:的)?|(?:没|没有)问题(?:的)?|嗯嗯?|行(?:的)?|ok|yes|correct|right|yep|sure)(?:(?:了|吧|呢|呀|啊|准|正确|(?:没|没有)问题|帮我(?:添|添加|加|加上|记录|确认|执行)(?:一下)?|请帮我(?:添|添加|加|加上|记录|确认|执行)(?:一下)?))*)+$/i;
const REJECT_PATTERN =
  /(不对|不是的|不要|取消|算了|错了|不用了|重来|结束|退出|不用|不加了|不做|no|cancel|wrong|nope)/i;

/**
 * ASR 有时会把“没问题”截成“没问”，或吞掉“没有问题”的最后一个字。
 * 只在确认轮、且整句没有食材/数量修正时使用，避免放宽普通业务指令。
 */
function isFuzzyConfirmation(text: string): boolean {
  return ['没问题', '没有问题', '是的没问题', '是的没有问题'].some(
    (candidate) => pinyinSimilarity(text, candidate) >= 0.76,
  );
}

/** 相对库存数量：支持“一半”(0.5) 和 “全部/都/全吃了/吃完了/删除/清空”(1.0)。 */
export function relativeInventoryFraction(rawReply: string): string | null {
  const normalized = normalizeTranscript(rawReply);
  if (/一半|半数|0\.5数?|百分之50|50%/.test(normalized)) return '0.5';
  if (/全部|都|全吃了|吃完了|用完了|所有.*删除|删掉|清空|全用掉/.test(normalized)) return '1.0';
  return null;
}

import { isPhoneticallyExit, pinyinSimilarity } from './phonetic-matcher';

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

  // 1. 先看是否是携带新值的修正（"不是两盒是三盒"里的"三盒"，"不是的我只用掉一"）
  const parsed = parseTranscript(normalized, catalog);
  const hasNewFood = parsed.items.length > 0;
  const bareQty = extractCorrectionQuantity(normalized);
  const hasBareQuantity = BARE_QUANTITY_PATTERN.test(normalized) || bareQty !== null;

  if (hasNewFood || hasBareQuantity) {
    // 纯确认词误伤保护：如果整句其实是"对"，parseTranscript 不会出食材，也无裸数量，走不到这里
    return {
      kind: 'CORRECTION',
      items: parsed.items,
      hasFood: hasNewFood,
      bareQuantity: hasNewFood ? null : bareQty,
    };
  }

  // 2. 带有否定词 + 修正助词（如 "不是的我只..."、"不对只要..."）强推为 CORRECTION
  if (/(?:不是|不对|错了|不要).*(?:只|要|改成|换成|变成|是用|用掉|吃了)/.test(normalized)) {
    return {
      kind: 'CORRECTION',
      items: [],
      hasFood: false,
      bareQuantity: { quantity: '1', unit: '' },
    };
  }

  // 3. 无新值：判断确认 / 拒绝
  const compactReply = normalized.replace(/[\s，。！？、,.!?：:；;“”‘’]/g, '');
  if (REJECT_PATTERN.test(compactReply)) return { kind: 'REJECT' };
  if (CONFIRM_PATTERN.test(compactReply) || isFuzzyConfirmation(compactReply)) {
    return { kind: 'CONFIRM' };
  }

  return { kind: 'UNCLEAR' };
}

// 裸数量+单位（无食材词），如"三盒"、"3个"、"改成两瓶"
const BARE_QUANTITY_PATTERN =
  /\d+(?:\.\d+)?\s*(千克|公斤|毫升|克|盒|瓶|包|袋|把|个|只|颗|枚|根|片|块|段|斤|升|kg|ml|g|l)/i;
