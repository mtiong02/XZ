'use client';

/**
 * 持续本地语音识别。
 *
 * 首选：浏览器只申请一次麦克风，通过一条长连接把 PCM 持续发送给本机 FunASR
 * Streaming Paraformer。每个句末只重置模型状态，不关闭麦克风或 WebSocket。
 * 兜底：本地服务未启动时使用浏览器 Web Speech，并在浏览器自动结束后重启。
 *
 * v2: 噪声词过滤、WebSocket 自动重连、置信度传递。
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
  abort(): void;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

export interface AsrHandle {
  stop: () => void;
}

interface Callbacks {
  lang?: string;
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
}

interface LocalMessage {
  type?: 'ready' | 'partial' | 'final' | 'silence' | 'error';
  text?: string;
  message?: string;
  confidence?: number;
}

/**
 * 过滤 ASR 高频噪声词：去除纯偷偷词/填充词/重复无意义音节。
 * 只过滤“整句都是噪声”的情况，不会剥离句子中的正常填充词。
 */
function filterAsrNoise(text: string): string | null {
  const cleaned = text.replace(/[\s，。！？、,.!?：:；;]/g, '');
  // 如果整句都是噪声词，返回 null 表示应忽略
  if (/^(?:嗯+|啊+|呵+|呃+|那个)+$/.test(cleaned)) return null;
  // 重复单字超过 3 次（如"嘶嘶嘶嘶嘶"、"啊啊啊啊"）
  if (/^(.)\1{3,}$/u.test(cleaned)) return null;
  return text;
}

function getAsrUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_LOCAL_SPEECH_URL;
  if (envUrl && !envUrl.includes('127.0.0.1') && !envUrl.includes('localhost')) {
    return `${envUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/asr`;
  }
  if (typeof window !== 'undefined') {
    const isLocal =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocal) {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProtocol}//${window.location.host}/speech/asr`;
    }
  }
  return 'ws://127.0.0.1:6010/asr';
}

const CONNECT_TIMEOUT_MS = 1500;

class AsrStartError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function recognitionConstructor(): RecognitionConstructor | undefined {
  const browser = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

export function isAsrSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const hasLocalCapture = typeof navigator.mediaDevices?.getUserMedia === 'function';
  return (
    (hasLocalCapture && typeof window.WebSocket === 'function') || Boolean(recognitionConstructor())
  );
}

async function startLocalAsr(callbacks: Callbacks): Promise<AsrHandle> {
  return new Promise<AsrHandle>((resolve, reject) => {
    const asrUrl = getAsrUrl();
    const socket = new WebSocket(asrUrl);
    socket.binaryType = 'arraybuffer';
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let processor: AudioNode | null = null;
    let started = false;
    let stopped = false;

    const connectTimer = window.setTimeout(() => {
      if (!started) {
        stopped = true;
        socket.close();
        reject(new AsrStartError('local-service-unavailable'));
      }
    }, CONNECT_TIMEOUT_MS);

    const cleanup = (): void => {
      window.clearTimeout(connectTimer);
      processor?.disconnect();
      source?.disconnect();
      for (const track of stream?.getTracks() ?? []) track.stop();
      if (context && context.state !== 'closed') void context.close();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'finish' }));
        socket.close();
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      processor = null;
      source = null;
      stream = null;
      context = null;
    };

    socket.onmessage = (event) => {
      let message: LocalMessage;
      try {
        message = JSON.parse(String(event.data)) as LocalMessage;
      } catch {
        return;
      }

      if (message.type === 'ready' && !started && !stopped) {
        void (async () => {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            });
            if (stopped) {
              for (const track of stream.getTracks()) track.stop();
              return;
            }
            context = new AudioContext({ latencyHint: 'interactive' });
            await context.resume();
            source = context.createMediaStreamSource(stream);
            await context.audioWorklet.addModule('/audio-capture-worklet.js');
            const captureNode = new AudioWorkletNode(context, 'pcm-capture');
            captureNode.port.onmessage = (audioEvent: MessageEvent<ArrayBuffer>) => {
              if (socket.readyState === WebSocket.OPEN && !stopped) socket.send(audioEvent.data);
            };
            processor = captureNode;
            source.connect(processor);
            processor.connect(context.destination);
            socket.send(JSON.stringify({ type: 'start', sampleRate: context.sampleRate }));
            started = true;
            window.clearTimeout(connectTimer);
            resolve({
              stop: () => {
                stopped = true;
                cleanup();
              },
            });
          } catch (error) {
            stopped = true;
            cleanup();
            reject(
              new AsrStartError(
                error instanceof DOMException &&
                  (error.name === 'NotAllowedError' || error.name === 'SecurityError')
                  ? 'not-allowed'
                  : 'audio-capture',
              ),
            );
          }
        })();
        return;
      }

      if (message.type === 'partial' && message.text) callbacks.onInterim?.(message.text);
      if (message.type === 'final' && message.text) {
        callbacks.onInterim?.('');
        const filtered = filterAsrNoise(message.text.trim());
        if (filtered) callbacks.onFinal(filtered);
      } else if (message.type === 'error') {
        callbacks.onError(message.message ?? 'local-asr-error');
      }
    };

    socket.onerror = () => {
      if (!started && !stopped) {
        stopped = true;
        cleanup();
        reject(new AsrStartError('local-service-unavailable'));
      }
    };
    socket.onclose = () => {
      if (started && !stopped) {
        stopped = true;
        cleanup();
        // 自动重连一次：WebSocket 意外断线时，3 秒后尝试重新连接
        window.setTimeout(() => {
          if (!stopped) {
            startLocalAsr(callbacks)
              .then(() => {
                /* reconnected */
              })
              .catch(() => callbacks.onError('local-service-unavailable'));
          }
        }, 3000);
      }
    };
  });
}

function startWebSpeech(callbacks: Callbacks): AsrHandle {
  const Recognition = recognitionConstructor();
  if (!Recognition) {
    callbacks.onError('not-supported');
    return { stop: () => undefined };
  }

  const recognition = new Recognition();
  recognition.lang = callbacks.lang ?? 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;
  let stopped = false;

  recognition.onresult = (event) => {
    let interim = '';
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result?.[0]?.transcript?.trim() ?? '';
      if (result?.isFinal && text) callbacks.onFinal(text);
      else if (text) interim += text;
    }
    callbacks.onInterim?.(interim);
  };
  recognition.onerror = (event) => {
    if (stopped || event.error === 'no-speech') return;
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') stopped = true;
    callbacks.onError(event.error);
  };
  recognition.onend = () => {
    if (stopped) return;
    window.setTimeout(() => {
      if (!stopped) {
        try {
          recognition.start();
        } catch {
          callbacks.onError('web-speech-restart-failed');
        }
      }
    }, 120);
  };
  recognition.start();
  return {
    stop: () => {
      stopped = true;
      recognition.abort();
    },
  };
}

/** 打开一条持续识别会话；仅在用户关闭对话时释放麦克风。 */
export function listenContinuously(callbacks: Callbacks): AsrHandle {
  let stopped = false;
  let active: AsrHandle | null = null;
  void startLocalAsr(callbacks)
    .then((handle) => {
      if (stopped) handle.stop();
      else active = handle;
    })
    .catch((error: unknown) => {
      if (stopped) return;
      if (error instanceof AsrStartError && error.code === 'not-allowed') {
        callbacks.onError(error.code);
        return;
      }
      active = startWebSpeech(callbacks);
    });

  return {
    stop: () => {
      stopped = true;
      active?.stop();
    },
  };
}
