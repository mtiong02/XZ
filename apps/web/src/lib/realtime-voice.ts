'use client';

function getRealtimeUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_LOCAL_SPEECH_URL;
  if (envUrl && !envUrl.includes('127.0.0.1') && !envUrl.includes('localhost')) {
    return `${envUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/realtime`;
  }
  if (typeof window !== 'undefined') {
    const isLocal =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocal) {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProtocol}//${window.location.host}/speech/realtime`;
    }
  }
  return 'ws://127.0.0.1:6010/realtime';
}

const CONNECT_TIMEOUT_MS = 12000;
const SPEECH_THRESHOLD = 0.011;
// 中文口语在补充数量、思考或说话顿音时常有自然停顿；
// 1.2 秒给足短暂停顿，同时避免用户说完后还要等两秒才提交。
// 这一处是实时链路唯一的 turn commit 判定，Paraformer 不再另行 endpoint 提交。
const END_SILENCE_MS = 1200;
const MIN_SPEECH_MS = 260;
const PRE_ROLL_CHUNKS = 8;
const HEARTBEAT_MS = 25_000;
// 本地 ASR 偶尔会在一轮结束时没有产出 final transcript；没有看门狗时
// turnPending 会一直卡住，后续所有语音都会被丢弃。
const COMMIT_WATCHDOG_MS = 4_500;

interface ServerMessage {
  type?:
    | 'ready'
    | 'partial'
    | 'transcript'
    | 'assistant-partial'
    | 'assistant-final'
    | 'audio-start'
    | 'audio-done'
    | 'wake'
    | 'standby'
    | 'active'
    | 'session-ending'
    | 'session-ended'
    | 'error';
  text?: string;
  message?: string;
}

export interface RealtimeVoiceCallbacks {
  onReady?: () => void;
  onListening?: () => void;
  onUserSpeechStart?: () => void;
  onWake?: (text: string) => void;
  onStandby?: () => void;
  onSessionActive?: () => void;
  onSessionEnding?: () => void;
  onSessionEnded?: () => void;
  onUserInterim?: (text: string) => void;
  onTranscript: (text: string) => void;
  onAssistantPartial?: (text: string) => void;
  onAssistantFinal?: (text: string) => void;
  onAudioStart?: () => void;
  onAudioDone?: () => void;
  onError: (message: string) => void;
}

export interface RealtimeVoiceHandle {
  respond(): void;
  sendText(text: string): void;
  noteAssistant(text: string): void;
  speakText(text: string): void;
  endSession(): void;
  cancelResponse(): void;
  stop(): void;
}

class PcmPlayer {
  private nextStartAt = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor(private readonly context: AudioContext) {}

  enqueue(pcm: ArrayBuffer): void {
    if (pcm.byteLength < 2) return;
    const view = new DataView(pcm);
    const samples = new Float32Array(Math.floor(pcm.byteLength / 2));
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32768;
    }
    const buffer = this.context.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    // 给流式音频一个很小的抗抖动缓冲。25ms 在移动网络上容易发生下溢卡顿；
    // 90ms 仍接近实时，但能吸收相邻 PCM 分片的网络抖动。
    const bufferLead = this.nextStartAt <= this.context.currentTime + 0.03 ? 0.09 : 0.025;
    const startAt = Math.max(this.context.currentTime + bufferLead, this.nextStartAt);
    source.start(startAt);
    this.nextStartAt = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  stop(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // 已自然结束的节点不需要再次停止。
      }
    }
    this.sources.clear();
    this.nextStartAt = 0;
  }

  async waitUntilIdle(): Promise<void> {
    const delayMs = Math.max(0, (this.nextStartAt - this.context.currentTime) * 1000 + 30);
    if (delayMs > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
  }
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/**
 * 本机 Paraformer 先输出文本并完成工具路由；普通对话再交给 MiniMax 推理和流式播音。
 * 浏览器端只做轻量 VAD，密钥始终留在本机代理。
 */
export async function startRealtimeVoice(
  callbacks: RealtimeVoiceCallbacks,
): Promise<RealtimeVoiceHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const context = new AudioContext({ latencyHint: 'interactive' });
  await context.resume();
  const player = new PcmPlayer(context);
  const realtimeUrl = getRealtimeUrl();
  const socket = new WebSocket(realtimeUrl);
  socket.binaryType = 'arraybuffer';
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: AudioWorkletNode | null = null;
  let stopped = false;
  let ready = false;
  let responsePlaying = false;
  let audioGeneration = 0;
  let assistantText = '';
  let assistantFinalSent = false;
  let suppressAssistantText = false;
  let speechActive = false;
  let turnPending = false;
  let armed = false;
  let speechMs = 0;
  let silenceMs = 0;
  const voiceStartedAt = performance.now();
  let committedAt: number | null = null;
  let heartbeat: number | null = null;
  let commitWatchdog: number | null = null;
  const preRoll: ArrayBuffer[] = [];

  const sendControl = (value: object): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  };
  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
    if (heartbeat) window.clearInterval(heartbeat);
    heartbeat = null;
    if (commitWatchdog) window.clearTimeout(commitWatchdog);
    commitWatchdog = null;
    player.stop();
    processor?.disconnect();
    source?.disconnect();
    for (const track of stream.getTracks()) track.stop();
    if (context.state !== 'closed') void context.close();
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  };

  return await new Promise<RealtimeVoiceHandle>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (ready) return;
      cleanup();
      reject(new Error('MiniMax Realtime 连接超时'));
    }, CONNECT_TIMEOUT_MS);

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        player.enqueue(event.data);
        return;
      }
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (message.type === 'ready' && !ready) {
        void (async () => {
          try {
            await context.audioWorklet.addModule('/audio-capture-worklet.js');
            source = context.createMediaStreamSource(stream);
            processor = new AudioWorkletNode(context, 'pcm-capture');
            processor.port.onmessage = (audioEvent: MessageEvent<ArrayBuffer>) => {
              if (stopped || socket.readyState !== WebSocket.OPEN) return;
              const data = audioEvent.data;
              const samples = new Float32Array(data);
              const chunkMs = (samples.length / context.sampleRate) * 1000;
              socket.send(data);
              // 播音期间提高门槛，避免扬声器回声把模型自己的声音误判成用户打断。
              const voiced = rms(samples) >= (responsePlaying ? 0.032 : SPEECH_THRESHOLD);

              if (!speechActive) {
                if (turnPending && !responsePlaying) return;
                preRoll.push(data.slice(0));
                if (preRoll.length > PRE_ROLL_CHUNKS) preRoll.shift();
                if (!voiced) return;
                speechActive = true;
                speechMs = chunkMs;
                silenceMs = 0;
                if (armed) callbacks.onUserSpeechStart?.();
                if (armed) sendControl({ type: 'activity' });
                preRoll.length = 0;
                return;
              }

              speechMs += chunkMs;
              silenceMs = voiced ? 0 : silenceMs + chunkMs;
              if (silenceMs >= END_SILENCE_MS && speechMs >= MIN_SPEECH_MS) {
                if (armed && !responsePlaying) {
                  committedAt = performance.now();
                  sendControl({ type: 'commit' });
                  if (commitWatchdog) window.clearTimeout(commitWatchdog);
                  commitWatchdog = window.setTimeout(() => {
                    commitWatchdog = null;
                    // ASR 没有最终文本时也必须释放本轮，否则后续语音会被永久忽略。
                    if (!stopped && turnPending && !responsePlaying) {
                      turnPending = false;
                      callbacks.onListening?.();
                    }
                  }, COMMIT_WATCHDOG_MS);
                }
                turnPending = armed;
                speechActive = false;
                speechMs = 0;
                silenceMs = 0;
                preRoll.length = 0;
                callbacks.onListening?.();
              }
            };
            source.connect(processor);
            processor.connect(context.destination);
            sendControl({ type: 'start', sampleRate: context.sampleRate });
            ready = true;
            window.clearTimeout(timer);
            sendControl({
              type: 'metric',
              metric: 'client_ready_ms',
              elapsedMs: performance.now() - voiceStartedAt,
            });
            heartbeat = window.setInterval(() => sendControl({ type: 'ping' }), HEARTBEAT_MS);
            callbacks.onReady?.();
            resolve({
              respond: () => {
                turnPending = true;
                sendControl({ type: 'respond' });
              },
              sendText: (text) => sendControl({ type: 'text', text }),
              noteAssistant: (text) => {
                sendControl({ type: 'assistant', text });
                turnPending = false;
              },
              speakText: (text) => sendControl({ type: 'speak', text }),
              endSession: () => {
                armed = false;
                turnPending = false;
                speechActive = false;
                sendControl({ type: 'end-session' });
              },
              cancelResponse: () => {
                sendControl({ type: 'cancel' });
                player.stop();
                responsePlaying = false;
                suppressAssistantText = true;
                assistantText = '';
                assistantFinalSent = true;
                audioGeneration += 1;
              },
              stop: cleanup,
            });
          } catch (error) {
            cleanup();
            reject(error);
          }
        })();
      } else if (message.type === 'wake') {
        if (commitWatchdog) window.clearTimeout(commitWatchdog);
        commitWatchdog = null;
        armed = true;
        speechActive = false;
        turnPending = false;
        speechMs = 0;
        silenceMs = 0;
        preRoll.length = 0;
        callbacks.onWake?.(message.text ?? '小知小知');
        if (responsePlaying) {
          sendControl({ type: 'cancel' });
          player.stop();
          responsePlaying = false;
          audioGeneration += 1;
        }
      } else if (message.type === 'standby') {
        if (commitWatchdog) window.clearTimeout(commitWatchdog);
        commitWatchdog = null;
        armed = false;
        speechActive = false;
        turnPending = false;
        speechMs = 0;
        silenceMs = 0;
        preRoll.length = 0;
        callbacks.onStandby?.();
      } else if (message.type === 'active') {
        armed = true;
        turnPending = false;
        callbacks.onSessionActive?.();
      } else if (message.type === 'session-ending') {
        armed = false;
        callbacks.onSessionEnding?.();
      } else if (message.type === 'session-ended') {
        if (commitWatchdog) window.clearTimeout(commitWatchdog);
        commitWatchdog = null;
        armed = false;
        turnPending = false;
        callbacks.onSessionEnded?.();
      } else if (message.type === 'partial' && message.text && armed) {
        callbacks.onUserInterim?.(message.text);
      } else if (message.type === 'transcript' && message.text?.trim() && armed) {
        if (commitWatchdog) window.clearTimeout(commitWatchdog);
        commitWatchdog = null;
        turnPending = false;
        if (committedAt !== null) {
          sendControl({
            type: 'metric',
            metric: 'turn_to_transcript_ms',
            elapsedMs: performance.now() - committedAt,
          });
        }
        callbacks.onTranscript(message.text.trim());
      } else if (message.type === 'audio-start') {
        if (committedAt !== null) {
          sendControl({
            type: 'metric',
            metric: 'turn_to_first_audio_ms',
            elapsedMs: performance.now() - committedAt,
          });
          committedAt = null;
        }
        responsePlaying = true;
        suppressAssistantText = false;
        audioGeneration += 1;
        assistantText = '';
        assistantFinalSent = false;
        callbacks.onAudioStart?.();
      } else if (message.type === 'assistant-partial' && message.text) {
        if (suppressAssistantText) return;
        assistantText += message.text;
        callbacks.onAssistantPartial?.(assistantText);
      } else if (message.type === 'assistant-final') {
        if (suppressAssistantText) return;
        const text = message.text?.trim() || assistantText.trim();
        if (text) callbacks.onAssistantFinal?.(text);
        assistantFinalSent = true;
      } else if (message.type === 'audio-done') {
        if (commitWatchdog) window.clearTimeout(commitWatchdog);
        commitWatchdog = null;
        const generation = audioGeneration;
        void player.waitUntilIdle().then(() => {
          if (stopped || generation !== audioGeneration) return;
          responsePlaying = false;
          turnPending = false;
          if (!assistantFinalSent && assistantText.trim()) {
            callbacks.onAssistantFinal?.(assistantText.trim());
          }
          sendControl({ type: 'playback-done' });
          callbacks.onAudioDone?.();
        });
      } else if (message.type === 'error') {
        callbacks.onError(message.message ?? 'MiniMax Realtime 请求失败');
      }
    };

    socket.onerror = () => {
      if (!ready) {
        window.clearTimeout(timer);
        cleanup();
        reject(new Error('无法连接本机 MiniMax Realtime 代理'));
      } else {
        callbacks.onError('MiniMax Realtime 连接中断');
      }
    };
    socket.onclose = () => {
      if (!stopped && ready) callbacks.onError('MiniMax Realtime 已断开');
      cleanup();
    };
  });
}
