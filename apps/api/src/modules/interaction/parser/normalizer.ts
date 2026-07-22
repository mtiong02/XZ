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

  // “一千克”里的“千”属于单位而非数量位，先保护复合单位再转换中文数字。
  text = text.replace(/千克/g, '__UNIT_KG__');

  // 中文数字 -> 阿拉伯数字（仅当后面跟单位/量词或食材语境时也统一转换）
  text = text.replace(CN_NUMBER_PATTERN, (match, offset: number, source: string) => {
    // 避免把口语助词误转成数字，例如“添加一下”不应变成“添加1下”。
    // 单字数量只有紧接量词/单位时才转换；“一片”“一盒”仍会正常转换。
    const next = source[offset + match.length] ?? '';
    if (match.length === 1 && /[下些样般直会起定]/.test(next)) return match;
    const value = chineseNumberToDigits(match);
    return value === null ? match : String(value);
  });

  return text.replace(/__UNIT_KG__/g, '千克');
}
