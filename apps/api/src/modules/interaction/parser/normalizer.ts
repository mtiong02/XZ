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

export function normalizeTranscript(raw: string): string {
  let text = raw
    // 全角数字/字母 -> 半角
    .replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xff10))
    .replace(/\s+/g, ' ')
    .trim();

  // 1. 归一化模糊量词（少量/少许/适量/一点 -> 1份）
  text = text.replace(/(?:少量|少许|适量|一点点|一点|稍微)/g, '1份');

  // 2. 归一化“几根/几个/几包” -> 默认3个
  text = text.replace(/几(根|个|包|袋|盒|颗|片|只|只|瓶)/g, '3$1');

  // “一千克”里的“千”属于单位而非数量位，先保护复合单位再转换中文数字。
  text = text.replace(/千克/g, '__UNIT_KG__');

  // 3. 中文数字 -> 阿拉伯数字
  text = text.replace(CN_NUMBER_PATTERN, (match, offset: number, source: string) => {
    // 避免把口语助词误转成数字，例如“添加一下”不应变成“添加1下”。
    const next = source[offset + match.length] ?? '';
    if (match.length === 1 && /[下些样般直会起定]/.test(next)) return match;
    const value = chineseNumberToDigits(match);
    return value === null ? match : String(value);
  });

  text = text.replace(/__UNIT_KG__/g, '千克');

  // 4. 转换“1斤半”、“2盒半” -> “1.5斤”、“2.5盒”
  text = text.replace(/(\d+)\s*(斤|个|盒|包|袋|瓶|块|片|颗|只|根)半/g, (_m, num, unit) => {
    return `${Number(num) + 0.5}${unit}`;
  });

  return text;
}
