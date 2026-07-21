'use client';

const LOCAL_SPEECH_HTTP = process.env.NEXT_PUBLIC_LOCAL_SPEECH_URL ?? 'http://127.0.0.1:6010';
const REALTIME_URL = `${LOCAL_SPEECH_HTTP.replace(/^http/, 'ws').replace(/\/$/, '')}/realtime`;
const CONNECT_TIMEOUT_MS = 12000;
const SPEECH_THRESHOLD = 0.011;
const END_SILENCE_MS = 900;
const MIN_SPEECH_MS = 260;
const PRE_ROLL_CHUNKS = 8;

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
    const startAt = Math.max(this.context.currentTime + 0.025, this.nextStartAt);
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
  const socket = new WebSocket(REALTIME_URL);
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
  const preRoll: ArrayBuffer[] = [];

  const sendControl = (value: object): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  };
  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
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
                if (armed && !responsePlaying) sendControl({ type: 'commit' });
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
        armed = false;
        turnPending = false;
        callbacks.onSessionEnded?.();
      } else if (message.type === 'partial' && message.text && armed) {
        callbacks.onUserInterim?.(message.text);
      } else if (message.type === 'transcript' && message.text?.trim() && armed) {
        callbacks.onTranscript(message.text.trim());
      } else if (message.type === 'audio-start') {
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
