'use client';

/**
 * 本地文本转语音。
 *
 * 浏览器支持 Web Speech 时始终使用操作系统声线，点击后可立即播放且支持打断；
 * 只有浏览器完全不支持 Web Speech 时才调用独立 speech 进程中的 Kokoro int8。
 */

const LOCAL_SPEECH_URL = (
  process.env.NEXT_PUBLIC_LOCAL_SPEECH_URL ?? 'http://127.0.0.1:6010'
).replace(/\/$/, '');
const SPEAK_TIMEOUT_MS = 12000;
const PREFERRED_VOICE_NAMES = ['Tingting', 'Ting-Ting', 'Yu-shu', 'Li-Mu', 'Meijia', 'Sin-ji'];

class TtsEngine {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private abortController: AbortController | null = null;
  private finishPlayback: (() => void) | null = null;
  private finishBuiltin: (() => void) | null = null;

  preload(): void {
    if (typeof window !== 'undefined') window.speechSynthesis?.getVoices();
  }

  async speak(text: string): Promise<void> {
    this.stop();
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        this.stop();
        resolve();
      }, SPEAK_TIMEOUT_MS);
      void this.speakInternal(text).finally(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  private async speakInternal(text: string): Promise<void> {
    // macOS/Chrome 的本地声线无网络、首字延迟低，也不会与持续 ASR 争抢 ONNX CPU。
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      await this.speakBuiltin(text);
      return;
    }
    try {
      this.abortController = new AbortController();
      const response = await fetch(`${LOCAL_SPEECH_URL}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: this.abortController.signal,
      });
      if (!response.ok) throw new Error(`Local TTS returned ${response.status}`);
      await this.playBlob(await response.blob());
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      await this.speakBuiltin(text);
    }
  }

  private playBlob(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      this.objectUrl = URL.createObjectURL(blob);
      this.audio = new Audio(this.objectUrl);
      const finish = () => {
        if (!this.audio && !this.objectUrl) return;
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
        this.audio = null;
        this.finishPlayback = null;
        resolve();
      };
      this.finishPlayback = finish;
      this.audio.onended = finish;
      this.audio.onerror = finish;
      void this.audio.play().catch(finish);
    });
  }

  private preferredSystemVoice(): SpeechSynthesisVoice | undefined {
    const voices = window.speechSynthesis.getVoices();
    for (const preferred of PREFERRED_VOICE_NAMES) {
      const match = voices.find((voice) => voice.localService && voice.name.includes(preferred));
      if (match) return match;
    }
    const localChinese = voices.find(
      (voice) => voice.localService && /^zh(?:[-_]|$)/i.test(voice.lang),
    );
    if (localChinese) return localChinese;
    for (const preferred of PREFERRED_VOICE_NAMES) {
      const match = voices.find((voice) => voice.name.includes(preferred));
      if (match) return match;
    }
    return voices.find((voice) => /^zh(?:[-_]|$)/i.test(voice.lang));
  }

  private speakBuiltin(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.voice = this.preferredSystemVoice() ?? null;
      utterance.rate = 1.06;
      utterance.pitch = 1;
      utterance.volume = 1;
      const finish = () => {
        this.finishBuiltin = null;
        resolve();
      };
      this.finishBuiltin = finish;
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    });
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.audio?.pause();
    this.finishPlayback?.();
    this.audio = null;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.finishBuiltin?.();
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  }
}

let engine: TtsEngine | null = null;

export function getTts(): TtsEngine {
  if (!engine) engine = new TtsEngine();
  return engine;
}
