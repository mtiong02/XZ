import { WebSocket, type RawData } from 'ws';
import { MINIMAX_ASSISTANT_INSTRUCTIONS } from './assistant-policy';

export interface MiniMaxRealtimeOptions {
  apiKey: string;
  model: string;
  voice: string;
  debug?: boolean;
  onTranscript?: (text: string) => void;
  transcriber?: {
    setSampleRate(sampleRate: number): void;
    setMode(mode: 'standby' | 'active'): void;
    accept(samples: Float32Array): void;
    finishTurn(): void;
    close(): void;
    onTranscript?: (text: string) => void;
    onWake?: () => void;
  };
}

interface ClientControl {
  type?:
    | 'start'
    | 'commit'
    | 'respond'
    | 'cancel'
    | 'text'
    | 'assistant'
    | 'speak'
    | 'server-wake'
    | 'activity'
    | 'playback-done';
  sampleRate?: number;
  text?: string;
}

interface MiniMaxEvent {
  type?: string;
  previous_item_id?: string | null;
  delta?: string;
  transcript?: string;
  error?: { message?: string; code?: string };
  item?: {
    id?: string;
    role?: string;
    content?: Array<{ type?: string; transcript?: string; text?: string }>;
  };
  response?: { status?: string };
}

const SESSION_IDLE_MS = 30000;
const GOODBYE_TEXT = '如果没有其他问题，我就先退下了。需要我的时候再叫我。';
const WAKE_GREETING_TEXT = '我在，请说。';
const TRANSCRIPT_DEDUP_WINDOW_MS = 2500;

export function isEndConversation(text: string): boolean {
  const compact = text.replace(/[\s，。！？、,.!?：:；;“”‘’'"`]/g, '');
  return (
    /^(?:我(?:们)?(?:要|想|先)?|请)?(?:结束|退出|关闭|停止)(?:这段|本次|当前)?(?:对话|对换|兑换|绘话|会话|聊天|对|聊|会)?(?:了|吧)?$/.test(
      compact,
    ) ||
    /^(?:我们?)?(?:先这样|就这样|没事了|没有别的了|不聊了|结束吧|退下吧|先退下|你先退下)(?:吧|了)?$/.test(
      compact,
    )
  );
}

function sendJson(socket: WebSocket, value: object): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function rawToFloat32(data: RawData): Float32Array {
  const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Float32Array(bytes);
}

/** ASR 常把“⼩知⼩知”识别成小资小、小芝小尺等近音字；唤醒词必须容错。 */
export function isWakePhrase(text: string): boolean {
  const compact = text.toLowerCase().replace(/[\s，。！？、,.!?：:；;“”‘’'"`]/g, '');
  const wakeChar = '[小晓少]';
  const nameChar = '[知智资芝滋咨子值字只之尺]+';
  return new RegExp(`${wakeChar}${nameChar}${wakeChar}(?:${nameChar})?`).test(compact);
}

export function normalizeRealtimeTranscript(text: string): string {
  return text.toLowerCase().replace(/[\s，。！？、,.!?：:；;“”‘’'"`]/g, '');
}

/** 将浏览器 AudioContext 的 Float32 PCM 重采样为 MiniMax 所需的 24kHz/16bit/mono。 */
export function float32ToPcm16(input: Float32Array, sourceRate: number): Buffer {
  const targetRate = 24000;
  const outputLength = Math.max(1, Math.round((input.length * targetRate) / sourceRate));
  const output = Buffer.allocUnsafe(outputLength * 2);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const leftIndex = Math.min(input.length - 1, Math.floor(position));
    const rightIndex = Math.min(input.length - 1, leftIndex + 1);
    const fraction = position - leftIndex;
    const left = input[leftIndex] ?? 0;
    const right = input[rightIndex] ?? left;
    const sample = Math.max(-1, Math.min(1, left + (right - left) * fraction));
    output.writeInt16LE(Math.round(sample < 0 ? sample * 32768 : sample * 32767), index * 2);
  }
  return output;
}

function userTranscript(event: MiniMaxEvent): string {
  if (event.type === 'conversation.item.input_audio_transcription.completed') {
    return event.transcript?.trim() ?? '';
  }
  if (event.type !== 'conversation.item.created' || event.item?.role !== 'user') return '';
  for (const content of event.item.content ?? []) {
    const transcript = content.transcript?.trim();
    if (transcript) return transcript;
  }
  return '';
}

/**
 * 浏览器只连接本机；本机代表浏览器携带密钥连接 MiniMax。
 * 客户端自己做轻量 VAD，并在一句结束时发送 commit；收到转录后再决定走库存工具或让模型回答。
 */
export function handleMiniMaxRealtime(client: WebSocket, options: MiniMaxRealtimeOptions): void {
  if (!options.apiKey) {
    sendJson(client, { type: 'error', message: '在线语音未配置，请设置 MINIMAX_API_KEY。' });
    client.close(1011, 'MiniMax API key missing');
    return;
  }

  const upstreamUrl = `wss://api.minimax.chat/ws/v1/realtime?model=${encodeURIComponent(options.model)}`;
  const upstream = new WebSocket(upstreamUrl, {
    headers: { Authorization: `Bearer ${options.apiKey}` },
    handshakeTimeout: 10000,
  });
  let sourceRate = 48000;
  let responseInProgress = false;
  let closed = false;
  let armed = false;
  let pendingWake = false;
  let sessionActive = false;
  let endingSession = false;
  let awaitingPlaybackDone = false;
  let pendingSpeakText: string | null = null;
  let suppressResponseOutput = false;
  let currentResponseKind: 'assistant' | 'system' = 'assistant';
  let sessionTimer: ReturnType<typeof setTimeout> | null = null;
  const requestResponse = (kind: 'assistant' | 'system' = 'assistant'): void => {
    responseInProgress = true;
    suppressResponseOutput = false;
    currentResponseKind = kind;
    sendJson(upstream, {
      type: 'response.create',
      response: { modalities: ['text', 'audio'], output_audio_format: 'pcm16' },
    });
  };
  const speakSystemText = (text: string): void => {
    sendJson(upstream, {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        status: 'completed',
        role: 'user',
        content: [
          { type: 'input_text', text: `请用自然中文原样播报这条系统提示，不要补充内容：${text}` },
        ],
      },
    });
    requestResponse('system');
  };
  const finishSession = (): void => {
    if (!sessionActive || endingSession) return;
    endingSession = true;
    sessionActive = false;
    pendingWake = false;
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = null;
    armed = false;
    options.transcriber?.setMode('standby');
    sendJson(client, { type: 'session-ending' });
    sendJson(upstream, { type: 'input_audio_buffer.clear' });
    if (responseInProgress) {
      pendingSpeakText = GOODBYE_TEXT;
      suppressResponseOutput = true;
      sendJson(upstream, { type: 'response.cancel' });
    } else {
      speakSystemText(GOODBYE_TEXT);
    }
  };
  const scheduleSessionTimeout = (): void => {
    if (sessionTimer) clearTimeout(sessionTimer);
    if (!sessionActive || endingSession) return;
    sessionTimer = setTimeout(() => {
      sessionTimer = null;
      if (responseInProgress) {
        scheduleSessionTimeout();
        return;
      }
      finishSession();
    }, SESSION_IDLE_MS);
  };
  const enterActiveSession = (): void => {
    sessionActive = true;
    endingSession = false;
    armed = true;
    options.transcriber?.setMode('active');
    scheduleSessionTimeout();
    sendJson(client, { type: 'active' });
  };
  const speakWakeGreeting = (): void => {
    speakSystemText(WAKE_GREETING_TEXT);
  };
  const returnToStandby = (): void => {
    if (sessionActive && !endingSession) {
      enterActiveSession();
      return;
    }
    if (!endingSession) {
      armed = false;
      options.transcriber?.setMode('standby');
      sendJson(client, { type: 'standby' });
    }
  };
  const wakeDetected = (text: string): void => {
    if (!isWakePhrase(text)) return;
    enterActiveSession();
    sendJson(client, { type: 'wake', text: '小知小知' });
    if (responseInProgress) {
      pendingWake = true;
      suppressResponseOutput = true;
      sendJson(upstream, { type: 'response.cancel' });
      return;
    }
    pendingWake = false;
    speakWakeGreeting();
  };
  if (options.transcriber) options.transcriber.onWake = () => wakeDetected('小知小知');
  if (options.transcriber) {
    options.transcriber.onTranscript = (text) => {
      if (isEndConversation(text)) {
        finishSession();
        return;
      }
      sendJson(client, { type: 'transcript', text });
      scheduleSessionTimeout();
    };
  }
  let pendingAssistantText: string | null = null;
  let lastTranscript = '';
  let lastTranscriptAt = 0;
  let lastAudioItem: {
    id: string;
    previousItemId: string | null;
    transcript: string;
  } | null = null;

  const archiveLastAudioItem = (): void => {
    const audioItem = lastAudioItem;
    if (!audioItem) return;
    // MiniMax 当前只允许模型上下文中保留一个 input_audio，且它必须是最新输入。
    // 一轮结束后用转录文本原位替换音频项，下一轮才能继续提交新音频。
    sendJson(upstream, {
      type: 'conversation.item.create',
      previous_item_id: audioItem.previousItemId,
      item: {
        type: 'message',
        status: 'completed',
        role: 'user',
        content: [{ type: 'input_text', text: audioItem.transcript }],
      },
    });
    sendJson(upstream, { type: 'conversation.item.delete', item_id: audioItem.id });
    lastAudioItem = null;
  };

  const appendAssistantText = (text: string): void => {
    sendJson(upstream, {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'text', text }],
      },
    });
  };

  const closeBoth = (): void => {
    if (closed) return;
    closed = true;
    if (sessionTimer) clearTimeout(sessionTimer);
    options.transcriber?.close();
    if (client.readyState === WebSocket.OPEN) client.close();
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  };

  upstream.on('message', (data) => {
    let event: MiniMaxEvent;
    try {
      event = JSON.parse(data.toString()) as MiniMaxEvent;
    } catch {
      return;
    }

    if (options.debug && event.type !== 'response.audio.delta') {
      process.stdout.write(
        `${JSON.stringify({
          msg: 'minimax.event',
          type: event.type,
          previous_item_id: event.previous_item_id,
          item: event.item
            ? {
                id: event.item.id,
                role: event.item.role,
                content: event.item.content?.map((content) => ({
                  type: content.type,
                  transcript: content.transcript,
                  text: content.text,
                })),
              }
            : undefined,
          transcript: event.transcript,
          error: event.error,
        })}\n`,
      );
    }

    if (event.type === 'session.created') {
      sendJson(upstream, {
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: MINIMAX_ASSISTANT_INSTRUCTIONS,
          voice: options.voice,
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          temperature: 0.7,
          max_response_output_tokens: '500',
        },
      });
      return;
    }
    if (event.type === 'session.updated') {
      sendJson(client, { type: 'ready', provider: 'minimax-realtime', sampleRate: 24000 });
      return;
    }

    const transcript = userTranscript(event);
    if (transcript) {
      const normalizedTranscript = normalizeRealtimeTranscript(transcript);
      const now = Date.now();
      if (
        normalizedTranscript.length > 0 &&
        normalizedTranscript === lastTranscript &&
        now - lastTranscriptAt < TRANSCRIPT_DEDUP_WINDOW_MS
      ) {
        return;
      }
      lastTranscript = normalizedTranscript;
      lastTranscriptAt = now;
      const containsAudio = event.item?.content?.some((content) => content.type === 'input_audio');
      if (containsAudio && event.item?.id) {
        lastAudioItem = {
          id: event.item.id,
          previousItemId: event.previous_item_id ?? null,
          transcript,
        };
      }
      options.transcriber?.onTranscript?.(transcript);
    }

    if (event.type === 'response.created') {
      if (sessionTimer) clearTimeout(sessionTimer);
      sessionTimer = null;
      responseInProgress = true;
      armed = false;
      options.transcriber?.setMode('standby');
      sendJson(client, { type: 'standby' });
      sendJson(client, { type: 'audio-start' });
    } else if (event.type === 'response.audio.delta' && event.delta && !suppressResponseOutput) {
      if (client.readyState === WebSocket.OPEN) client.send(Buffer.from(event.delta, 'base64'));
    } else if (
      (event.type === 'response.audio_transcript.delta' || event.type === 'response.text.delta') &&
      event.delta &&
      !suppressResponseOutput &&
      currentResponseKind === 'assistant'
    ) {
      sendJson(client, { type: 'assistant-partial', text: event.delta });
    } else if (
      event.type === 'response.audio_transcript.done' ||
      event.type === 'response.text.done'
    ) {
      if (!suppressResponseOutput && currentResponseKind === 'assistant') {
        sendJson(client, { type: 'assistant-final', text: event.transcript ?? '' });
      }
    } else if (event.type === 'response.done') {
      responseInProgress = false;
      awaitingPlaybackDone = true;
      archiveLastAudioItem();
      if (pendingAssistantText) {
        appendAssistantText(pendingAssistantText);
        pendingAssistantText = null;
      }
      sendJson(client, { type: 'audio-done', status: event.response?.status ?? 'completed' });
      if (pendingSpeakText && !pendingWake) {
        const text = pendingSpeakText;
        pendingSpeakText = null;
        awaitingPlaybackDone = false;
        speakSystemText(text);
      }
    } else if (event.type === 'error') {
      sendJson(client, {
        type: 'error',
        code: event.error?.code,
        message: event.error?.message ?? 'MiniMax Realtime 请求失败',
      });
    }
  });

  upstream.on('error', (error) => {
    sendJson(client, { type: 'error', message: `MiniMax Realtime 连接失败：${error.message}` });
  });
  upstream.on('close', (code) => {
    if (!closed) sendJson(client, { type: 'error', message: `MiniMax Realtime 已断开（${code}）` });
    closeBoth();
  });

  client.on('message', (data, isBinary) => {
    if (upstream.readyState !== WebSocket.OPEN) return;
    try {
      if (isBinary) {
        const samples = rawToFloat32(data);
        if (samples.length === 0) return;
        options.transcriber?.accept(samples);
        return;
      }
      const message = JSON.parse(data.toString()) as ClientControl;
      if (message.type === 'server-wake') {
        wakeDetected('小知小知');
        return;
      }
      if (message.type === 'start' && Number.isFinite(message.sampleRate)) {
        sourceRate = Math.max(8000, Math.min(96000, Math.round(message.sampleRate ?? 48000)));
        options.transcriber?.setSampleRate(sourceRate);
      } else if (message.type === 'commit') {
        if (responseInProgress) return;
        options.transcriber?.finishTurn();
        if (!armed) return;
        if (sessionTimer) clearTimeout(sessionTimer);
        sessionTimer = null;
        // 先让本机 Paraformer 产出最终文本并经过库存工具路由。只有确定为普通
        // 对话后，前端才用 text + respond 请求 MiniMax，避免模型与工具同时抢答。
      } else if (message.type === 'activity') {
        scheduleSessionTimeout();
      } else if (message.type === 'playback-done' && awaitingPlaybackDone) {
        awaitingPlaybackDone = false;
        if (endingSession) {
          endingSession = false;
          armed = false;
          options.transcriber?.setMode('standby');
          sendJson(client, { type: 'session-ended' });
        } else if (pendingWake) {
          pendingWake = false;
          speakWakeGreeting();
        } else {
          returnToStandby();
        }
      } else if (message.type === 'respond') {
        if (!responseInProgress) requestResponse();
      } else if (message.type === 'text' && message.text?.trim()) {
        sendJson(upstream, {
          type: 'conversation.item.create',
          item: {
            type: 'message',
            status: 'completed',
            role: 'user',
            content: [{ type: 'input_text', text: message.text.trim() }],
          },
        });
      } else if (message.type === 'speak' && message.text?.trim()) {
        if (responseInProgress) {
          pendingSpeakText = message.text.trim();
          suppressResponseOutput = true;
          sendJson(upstream, { type: 'response.cancel' });
        } else {
          speakSystemText(message.text.trim());
        }
      } else if (message.type === 'assistant' && message.text?.trim()) {
        archiveLastAudioItem();
        if (responseInProgress) pendingAssistantText = message.text.trim();
        else appendAssistantText(message.text.trim());
      } else if (message.type === 'cancel' && responseInProgress) {
        suppressResponseOutput = true;
        sendJson(upstream, { type: 'response.cancel' });
      }
    } catch (error) {
      sendJson(client, {
        type: 'error',
        message: error instanceof Error ? error.message : '音频代理失败',
      });
    }
  });

  client.on('close', closeBoth);
  client.on('error', closeBoth);
}
