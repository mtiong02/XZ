/** 单位码 -> 口语量词（用于 TTS 播报）。 */
const SPOKEN: Record<string, string> = {
  piece: '个',
  box: '盒',
  bottle: '瓶',
  pack: '包',
  bag: '袋',
  bunch: '把',
  g: '克',
  kg: '千克',
  ml: '毫升',
  l: '升',
};

export function unitSpokenLabel(code: string): string {
  return SPOKEN[code] ?? code;
}
