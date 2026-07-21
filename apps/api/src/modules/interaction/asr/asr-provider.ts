/**
 * ASR Provider Adapter（ADR-008）：业务代码只依赖此接口。
 * 生产接入真实供应商（如 Whisper API、Google STT）时新增实现并以 env 切换；
 * 本地/测试默认 NotConfiguredProvider——音频任务优雅失败并引导文本/Web Speech 通道。
 */

export interface TranscriptionResult {
  text: string;
  confidence: number;
  language: string;
}

export interface SpeechRecognitionProvider {
  readonly name: string;
  transcribe(audio: Buffer, options: { locale: string }): Promise<TranscriptionResult>;
}

export class AsrNotConfiguredError extends Error {
  constructor() {
    super('No ASR provider configured');
    this.name = 'AsrNotConfiguredError';
  }
}

export class NotConfiguredAsrProvider implements SpeechRecognitionProvider {
  readonly name = 'not-configured';

  transcribe(): Promise<TranscriptionResult> {
    return Promise.reject(new AsrNotConfiguredError());
  }
}

/** 测试用：返回预设文本。 */
export class FixedAsrProvider implements SpeechRecognitionProvider {
  readonly name = 'fixed';

  constructor(private readonly text: string) {}

  transcribe(_audio: Buffer, options: { locale: string }): Promise<TranscriptionResult> {
    return Promise.resolve({ text: this.text, confidence: 0.95, language: options.locale });
  }
}

export const ASR_PROVIDER = Symbol('ASR_PROVIDER');

export function createAsrProviderFromEnv(): SpeechRecognitionProvider {
  // 未来：switch (process.env.ASR_PROVIDER) { case 'whisper': ... }
  return new NotConfiguredAsrProvider();
}
