'use client';

/**
 * 语音识别（采集用户一个回合的话）。
 *
 * 当前实现：浏览器内置 Web Speech API（真实 Chrome/Safari 端上识别，中英可切）。
 * 端上双语升级路径：sherpa-onnx 流式 Zipformer（WASM），见 docs/09。
 * 接口保持一致，升级时只替换本文件实现。
 */

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type Ctor = new () => SpeechRecognitionLike;

export function isAsrSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export interface AsrHandle {
  stop: () => void;
}

/**
 * 监听一句话。onInterim 实时回传中间结果；onFinal 在断句后回传最终文本。
 * onError 传递失败原因（no-speech / not-allowed 等）。
 */
export function listenOnce(callbacks: {
  lang?: string;
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
}): AsrHandle {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  const RecognitionCtor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!RecognitionCtor) {
    callbacks.onError('not-supported');
    return { stop: () => undefined };
  }
  const recognition = new RecognitionCtor();
  recognition.lang = callbacks.lang ?? 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  let finalText = '';
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result?.[0]?.transcript ?? '';
      if (result && 'isFinal' in result && result.isFinal) finalText += text;
      else interim += text;
    }
    if (interim) callbacks.onInterim?.(interim);
  };
  recognition.onerror = (event) => callbacks.onError(event.error);
  recognition.onend = () => {
    if (finalText.trim()) callbacks.onFinal(finalText.trim());
    else callbacks.onError('no-speech');
  };
  recognition.start();
  return { stop: () => recognition.stop() };
}
