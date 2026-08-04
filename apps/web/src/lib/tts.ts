'use client';

/**
 * 本地文本转语音。
 *
 * 浏览器支持 Web Speech 时始终使用操作系统声线，点击后可立即播放且支持打断；
 * 只有浏览器完全不支持 Web Speech 时才调用独立 speech 进程中的 Kokoro int8。
 *
 * v2: 播报队列串行、音量淡入/淡出、播报打断优化、超时分段。
 */

function getTtsUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_LOCAL_SPEECH_URL;
  if (envUrl && !envUrl.includes('127.0.0.1') && !envUrl.includes('localhost')) {
    return envUrl.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    const isLocal =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocal) {
      return `${window.location.origin}/speech`;
    }
  }
  return 'http://127.0.0.1:6010';
}

const SPEAK_TIMEOUT_MS = 8000;
const FADE_IN_MS = 200;
const FADE_OUT_MS = 150;
const PREFERRED_VOICE_NAMES = ['Tingting', 'Ting-Ting', 'Yu-shu', 'Li-Mu', 'Meijia', 'Sin-ji'];

class TtsEngine {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private abortController: AbortController | null = null;
  private finishPlayback: (() => void) | null = null;
  private finishBuiltin: (() => void) | null = null;
  /** 播报队列：多条 spoken_prompt 按顺序播放，避免重叠 */
  private queue: string[] = [];
  private processing = false;

  preload(): void {
    if (typeof window !== 'undefined') window.speechSynthesis?.getVoices();
  }

  /** 将文本加入播报队列，返回 Promise（播完 resolve）。 */
  async speak(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push(text);
      const processNext = async (): Promise<void> => {
        if (this.processing) {
          // 等当前播完后自动处理
          const waitInterval = setInterval(() => {
            if (!this.processing && this.queue.length === 0) {
              clearInterval(waitInterval);
              resolve();
            }
          }, 100);
          return;
        }
        this.processing = true;
        while (this.queue.length > 0) {
          const next = this.queue.shift()!;
          await this.speakSingle(next);
        }
        this.processing = false;
        resolve();
      };
      void processNext();
    });
  }

  private async speakSingle(text: string): Promise<void> {
    this.stopCurrent();
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        this.stopCurrent();
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
      const response = await fetch(`${getTtsUrl()}/tts`, {
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
      // 音量淡入
      this.audio.volume = 0;
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
      this.audio.ontimeupdate = () => {
        if (!this.audio) return;
        const elapsed = this.audio.currentTime * 1000;
        const remaining = (this.audio.duration - this.audio.currentTime) * 1000;
        // 淡入
        if (elapsed < FADE_IN_MS) {
          this.audio.volume = Math.min(1, elapsed / FADE_IN_MS);
        }
        // 淡出
        else if (remaining < FADE_OUT_MS && Number.isFinite(remaining)) {
          this.audio.volume = Math.max(0, remaining / FADE_OUT_MS);
        }
        // 正常音量
        else {
          this.audio.volume = 1;
        }
      };
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
      utterance.rate = 1.2;
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

  /** 停止当前播放（不清空队列） */
  private stopCurrent(): void {
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

  /** 停止所有播放并清空队列（用户打断时调用） */
  stop(): void {
    this.queue.length = 0;
    this.processing = false;
    this.stopCurrent();
  }
}

let engine: TtsEngine | null = null;

export function getTts(): TtsEngine {
  if (!engine) engine = new TtsEngine();
  return engine;
}
