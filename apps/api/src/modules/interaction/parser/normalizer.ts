/**
 * Transcript Normalizer（docs/02 §10.2）：
 * 中文数字 -> 阿拉伯数字、全角 -> 半角、去多余空白。
 * 纯函数，保留 raw 与 normalized 两份（docs/07 §9）。
 */

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  俩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/**
 * ASR 高频错别字预修复映射。
 * 在归一化的第一步执行，将 ASR 常见的同音字误识别替换为正确食材名。
 * 只处理高确定性、且不会误伤正常语句的映射。
 */
const ASR_TYPO_MAP: [RegExp, string][] = [
  [/机胸肉/g, '鸡胸肉'],
  [/机胸/g, '鸡胸'],
  [/鸡腿(?:股|鼓)/g, '鸡腿菇'],
  [/猪五花(?!肉)/g, '猪五花肉'],
  [/牛南/g, '牛腩'],
  [/虾人/g, '虾仁'],
  [/鸡但/g, '鸡蛋'],
  [/鲜乃/g, '鲜奶'],
  [/豆付/g, '豆腐'],
  [/生抽/g, '生抽'], // no-op guard: 防止后续规则误改
  [/耗油/g, '蚝油'],
  [/番切/g, '番茄'],
  [/西红是/g, '西红柿'],
  [/黄到/g, '黄豆'],
  [/马铃薯/g, '马铃薯'], // no-op guard
];

/**
 * 方言量词归一化映射。
 * 把日常口语中出现的非标准量词转换成标准量词，让下游 parser 能正确提取。
 */
const DIALECT_MEASURE_WORDS: [RegExp, (m: string, num: string) => string][] = [
  // 一打鸡蛋 / 1打鸡蛋 -> 12个鸡蛋
  [
    /(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*打(?=[^\s\d]*[\u4e00-\u9fa5])/g,
    (_m: string, numStr: string) => {
      const num = /^\d+$/.test(numStr) ? Number(numStr) : (chineseNumberToDigits(numStr) ?? 1);
      return `${num * 12}个`;
    },
  ],
  // 一扎xxx -> 1把xxx (扎 = 束, 如"一扎香菜")
  [
    /(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*扎/g,
    (_m: string, numStr: string) => {
      const num = /^\d+$/.test(numStr) ? Number(numStr) : (chineseNumberToDigits(numStr) ?? 1);
      return `${num}把`;
    },
  ],
  // 一墩肉 -> 1块肉
  [
    /(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*墩/g,
    (_m: string, numStr: string) => {
      const num = /^\d+$/.test(numStr) ? Number(numStr) : (chineseNumberToDigits(numStr) ?? 1);
      return `${num}块`;
    },
  ],
];

/** 解析常见中文数量（十、两百、二千、半…）。 */
function chineseNumberToDigits(text: string): number | null {
  if (text === '半') return 0.5;
  const multipliers: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let current: number | null = null;
  for (const character of text) {
    if (character in CN_DIGITS) {
      current = CN_DIGITS[character] ?? null;
      continue;
    }
    const multiplier = multipliers[character];
    if (!multiplier) return null;
    total += (current ?? 1) * multiplier;
    current = null;
  }
  return total + (current ?? 0);
}

const CN_NUMBER_PATTERN = /[一二两俩三四五六七八九十百千半零]{1,5}/g;

/**
 * 数量范围表达归一化：
 * "两三个" -> "2个"（取较小值，保守策略）
 * "三到五个" -> "4个"（取中间值）
 * "三四百克" -> "350克"（取中间值）
 */
function normalizeRangeExpressions(text: string): string {
  // "两三个" / "三四个" -> 取较小值
  text = text.replace(
    /([一二两三四五六七八九])([二三四五六七八九十])(个|只|颗|根|片|块|段|支|条|盒|瓶|罐|包|袋|把|串|份)/g,
    (_m, low: string, _high: string, unit: string) => {
      const lowVal = chineseNumberToDigits(low);
      return lowVal !== null ? `${lowVal}${unit}` : _m;
    },
  );
  // "三到五个" / "3到5个" / "三至五个"
  text = text.replace(
    /(\d+|[一二两三四五六七八九十百千]+)\s*(?:到|至)\s*(\d+|[一二两三四五六七八九十百千]+)\s*(个|只|颗|根|片|块|段|支|条|盒|瓶|罐|包|袋|把|串|份|克|斤|千克|两|升|毫升)/g,
    (_m, lowStr: string, highStr: string, unit: string) => {
      const low = /^\d+$/.test(lowStr) ? Number(lowStr) : chineseNumberToDigits(lowStr);
      const high = /^\d+$/.test(highStr) ? Number(highStr) : chineseNumberToDigits(highStr);
      if (low !== null && high !== null && high > low) {
        return `${Math.round((low + high) / 2)}${unit}`;
      }
      return _m;
    },
  );
  return text;
}

export function normalizeTranscript(raw: string): string {
  let text = raw
    // 全角数字/字母 -> 半角
    .replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xff10))
    .replace(/\s+/g, ' ')
    .trim();

  // 0. ASR 高频错别字预修复
  for (const [pattern, replacement] of ASR_TYPO_MAP) {
    text = text.replace(pattern, replacement);
  }

  // 1. 归一化模糊量词（少量/少许/适量/一点/一些/一堆 -> 1份）
  text = text.replace(/(?:少量|少许|适量|一点点|一点|稍微|一些|一堆)/g, '1份');

  // 2. 归一化"几根/几个/几包" -> 默认3个
  text = text.replace(/几(根|个|包|袋|盒|颗|片|只|只|瓶|碗|勺|杯)/g, '3$1');

  // 3. 方言量词归一化
  for (const [pattern, replacement] of DIALECT_MEASURE_WORDS) {
    text = text.replace(pattern, replacement as any);
  }

  // 4. 数量范围表达归一化
  text = normalizeRangeExpressions(text);

  // "一千克"里的"千"属于单位而非数量位，先保护复合单位再转换中文数字。
  text = text.replace(/千克/g, '__UNIT_KG__');

  // 5. 中文数字 -> 阿拉伯数字
  text = text.replace(CN_NUMBER_PATTERN, (match, offset: number, source: string) => {
    // 避免把口语助词误转成数字，例如"添加一下"不应变成"添加1下"。
    const next = source[offset + match.length] ?? '';
    if (match.length === 1 && /[下些样般直会起定]/.test(next)) return match;
    const value = chineseNumberToDigits(match);
    return value === null ? match : String(value);
  });

  text = text.replace(/__UNIT_KG__/g, '千克');

  // 6. 转换"1斤半"、"2盒半" -> "1.5斤"、"2.5盒" (由于前面"半"变成了"0.5")
  text = text.replace(
    /(\d+(?:\.\d+)?)\s*(斤|公斤|千克|克|个|盒|包|袋|瓶|块|片|颗|只|根|把|段|支|条|份|串|两|升|碗|勺|杯)0\.5/g,
    (_m, num, unit) => {
      return `${Number(num) + 0.5}${unit}`;
    },
  );

  // 7. "二两" 修复：在中文数字已经转换后，"2两" 不应该再被二次处理
  // （chineseNumberToDigits 对 "二" 返回 2，所以 "二两" -> "2两"，这是正确的）

  return text;
}
