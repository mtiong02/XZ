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

/** 解析 1-99 的中文数字（十、二十、二十五、半…）。 */
function chineseNumberToDigits(text: string): number | null {
  if (text === '半') return 0.5;
  if (text.length === 1) {
    if (text === '十') return 10;
    return CN_DIGITS[text] ?? null;
  }
  const tenIndex = text.indexOf('十');
  if (tenIndex === -1) return null;
  const tensPart = text.slice(0, tenIndex);
  const onesPart = text.slice(tenIndex + 1);
  const tens = tensPart === '' ? 1 : CN_DIGITS[tensPart];
  const ones = onesPart === '' ? 0 : CN_DIGITS[onesPart];
  if (tens === undefined || ones === undefined) return null;
  return tens * 10 + ones;
}

const CN_NUMBER_PATTERN = /[一二两俩三四五六七八九十半零]{1,3}/g;

export function normalizeTranscript(raw: string): string {
  let text = raw
    // 全角数字/字母 -> 半角
    .replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xff10))
    .replace(/\s+/g, ' ')
    .trim();

  // 中文数字 -> 阿拉伯数字（仅当后面跟单位/量词或食材语境时也统一转换）
  text = text.replace(CN_NUMBER_PATTERN, (match) => {
    const value = chineseNumberToDigits(match);
    return value === null ? match : String(value);
  });

  return text;
}
