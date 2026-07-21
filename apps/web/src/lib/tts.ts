'use client';

/**
 * 文本转语音（让系统"说话"，用于对话确认）。
 *
 * 分层降级（端上、零云依赖）：
 * 1. Kokoro（onnx-community/Kokoro-82M，浏览器 WASM，中英一体，自然度高）——首次用时懒加载 ~86MB，浏览器缓存；
 * 2. 浏览器内置 speechSynthesis（零下载、即刻可用）——Kokoro 加载完成前/失败时兜底。
 *
 * 这样对话在任何浏览器立即可用，Kokoro 就绪后自动升级音质。
 */

type KokoroModel = {
  generate: (text: string, opts: { voice: string }) => Promise<{ toBlob: () => Blob }>;
  voices?: Record<string, unknown>;
  list_voices?: () => string[];
};

// 优先的中文女声候选（不同模型构建里名字可能不同，取其中存在的第一个）
const DEFAULT_VOICE = 'zf_xiaoni';
const PREFERRED_ZH_VOICES = [DEFAULT_VOICE, 'zf_xiaobei', 'zf_xiaoxiao', 'zf_xiaoyi'];
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const SPEAK_TIMEOUT_MS = 8000;
// 运行时从 CDN 加载（webpackIgnore：不打进 bundle，避开 onnxruntime 的 wasm/node 二进制）。
// 生产可改为自托管 ESM；端上/冰箱贴形态可换 sherpa-onnx WASM（见 docs/09）。
const KOKORO_CDN = 'https://esm.sh/kokoro-js@1.2.1';

class TtsEngine {
  private kokoro: KokoroModel | null = null;
  private voice = DEFAULT_VOICE;
  private loading: Promise<void> | null = null;
  private failed = false;
  private audio: HTMLAudioElement | null = null;

  /** 后台预加载 Kokoro（不阻塞首次对话，加载好后自动接管）。 */
  preload(): void {
    void this.ensureKokoro();
  }

  private ensureKokoro(): Promise<void> {
    if (this.kokoro || this.failed) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const mod = (await import(/* webpackIgnore: true */ KOKORO_CDN)) as unknown as {
          KokoroTTS: { from_pretrained: (id: string, o: object) => Promise<KokoroModel> };
        };
        this.kokoro = await mod.KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: 'q8',
          device: 'wasm',
        });
        this.voice = this.pickVoice(this.kokoro);
      } catch {
        // 加载失败（离线/CSP）则永久回退到浏览器内置 TTS，对话不受影响
        this.failed = true;
      }
    })();
    return this.loading;
  }

  /** 从加载好的模型里选一个存在的中文女声，选不到就用可用列表第一个。 */
  private pickVoice(model: KokoroModel): string {
    const available = model.list_voices?.() ?? Object.keys(model.voices ?? {});
    for (const preferred of PREFERRED_ZH_VOICES) {
      if (available.includes(preferred)) return preferred;
    }
    const zh = available.find((v) => v.startsWith('zf') || v.startsWith('zm'));
    return zh ?? available[0] ?? DEFAULT_VOICE;
  }

  /** 播报一句话，返回播放完成的 Promise（带超时，绝不阻塞对话循环）。 */
  async speak(text: string): Promise<void> {
    await this.withTimeout(this.speakInternal(text));
  }

  private async speakInternal(text: string): Promise<void> {
    await this.ensureKokoro();
    if (this.kokoro) {
      try {
        const result = await this.kokoro.generate(text, { voice: this.voice });
        await this.playBlob(result.toBlob());
        return;
      } catch {
        // 该句合成失败则本句用内置兜底，但不永久禁用 Kokoro
      }
    }
    await this.speakBuiltin(text);
  }

  private withTimeout(p: Promise<void>): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, SPEAK_TIMEOUT_MS);
      void p.finally(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private playBlob(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      this.audio = new Audio(url);
      this.audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      this.audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      void this.audio.play().catch(() => resolve());
    });
  }

  private speakBuiltin(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        resolve();
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-CN';
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    });
  }

  stop(): void {
    this.audio?.pause();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }
}

let engine: TtsEngine | null = null;

export function getTts(): TtsEngine {
  if (!engine) engine = new TtsEngine();
  return engine;
}
