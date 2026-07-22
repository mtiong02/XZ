import { describe, expect, it } from 'vitest';
import { isPhoneticallyExit, pinyinSimilarity, textToPinyin } from './phonetic-matcher';

describe('Phonetic Homophone Matcher', () => {
  it('converts Chinese text to pinyin sequences', () => {
    expect(textToPinyin('结束对话')).toEqual(['jie', 'shu', 'dui', 'hua']);
    expect(textToPinyin('结束兑换')).toEqual(['jie', 'shu', 'dui', 'huan']);
  });

  it('calculates high phonetic similarity for homophones and near-homophones', () => {
    // "结束对话" vs "结束兑换"
    const score1 = pinyinSimilarity('结束对话', '结束兑换');
    expect(score1).toBeGreaterThan(0.85);

    // "结束对话" vs "结速对话"
    const score2 = pinyinSimilarity('结束对话', '结速对话');
    expect(score2).toBe(1.0);
  });

  it('correctly identifies phonetically similar exit commands', () => {
    expect(isPhoneticallyExit('结束兑换')).toBe(true);
    expect(isPhoneticallyExit('结束对换')).toBe(true);
    expect(isPhoneticallyExit('结束对话结束对话')).toBe(true);
    expect(isPhoneticallyExit('结速对话')).toBe(true);
    expect(isPhoneticallyExit('结束掉话')).toBe(true);
    expect(isPhoneticallyExit('你先退下吧')).toBe(true);

    // Non-exit commands
    expect(isPhoneticallyExit('结束后提醒我买牛奶')).toBe(false);
    expect(isPhoneticallyExit('加两盒牛奶')).toBe(false);
  });
});
