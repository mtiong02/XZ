import { describe, expect, it } from 'vitest';
import {
  float32ToPcm16,
  isEndConversation,
  isWakePhrase,
  normalizeRealtimeTranscript,
} from './minimax-realtime';

describe('float32ToPcm16', () => {
  it('downsamples 48kHz float audio to 24kHz signed PCM', () => {
    const output = float32ToPcm16(new Float32Array([0, 0.25, 0.5, 0.75]), 48000);
    expect(output.length).toBe(4);
    expect(output.readInt16LE(0)).toBe(0);
    expect(output.readInt16LE(2)).toBeCloseTo(16384, -1);
  });

  it('clamps samples to the pcm16 range', () => {
    const output = float32ToPcm16(new Float32Array([-2, 2]), 24000);
    expect(output.readInt16LE(0)).toBe(-32768);
    expect(output.readInt16LE(2)).toBe(32767);
  });
});

describe('isWakePhrase', () => {
  it.each(['小知小知', '小智小智', '小资小', '小芝小尺', '晓资晓资'])(
    'accepts ASR near-speech: %s',
    (text) => {
      expect(isWakePhrase(text)).toBe(true);
    },
  );

  it.each(['小白菜', '买两盒牛奶', '小知买菜'])('does not wake on ordinary speech: %s', (text) => {
    expect(isWakePhrase(text)).toBe(false);
  });
});

describe('normalizeRealtimeTranscript', () => {
  it('normalizes equivalent provider transcript events for de-duplication', () => {
    expect(normalizeRealtimeTranscript('冰箱里，还有哪些肉？')).toBe('冰箱里还有哪些肉');
  });
});

describe('isEndConversation', () => {
  it.each([
    '结束对话',
    '结束对',
    '结束兑换',
    '退出本次绘话',
    '退出本次',
    '我们先这样吧',
    '没事了',
    '你先退下吧',
    '没有有的的退下吧',
    '退出本次会话',
    '我要结束对话了',
    '不聊了',
    '结束吧',
    '先退下',
    '好的谢谢结束',
    '好吧结束对话',
    '那我们今天先这样吧',
    '就到这里吧',
    '下次再聊',
    '我先忙了，谢谢你',
    '别再听了',
    '不用继续说了',
    '拜拜',
    '晚安',
  ])('recognizes session ending: %s', (text) => {
    expect(isEndConversation(text)).toBe(true);
  });

  it.each(['结束后提醒我', '结束后提醒我买牛奶', '继续聊聊', '没有牛奶了', '请继续说'])(
    'keeps ordinary speech active: %s',
    (text) => {
      expect(isEndConversation(text)).toBe(false);
    },
  );
});
