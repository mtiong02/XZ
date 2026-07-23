import 'dotenv/config';
import { createRequire } from 'node:module';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { handleMiniMaxRealtime } from './minimax-realtime';
import { createSpeechRuntimeMetrics } from './runtime-metrics';

interface OnlineResult {
  text: string;
  is_final?: boolean;
}

interface OnlineStream {
  acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void;
  inputFinished(): void;
}

interface OnlineRecognizer {
  createStream(): OnlineStream;
  isReady(stream: OnlineStream): boolean;
  decode(stream: OnlineStream): void;
  isEndpoint(stream: OnlineStream): boolean;
  reset(stream: OnlineStream): void;
  getResult(stream: OnlineStream): OnlineResult;
}

interface KeywordSpotter {
  createStream(): OnlineStream;
  isReady(stream: OnlineStream): boolean;
  decode(stream: OnlineStream): void;
  reset(stream: OnlineStream): void;
  getResult(stream: OnlineStream): { keyword?: string };
}

interface GeneratedAudio {
  samples: Float32Array;
  sampleRate: number;
}

interface OfflineTts {
  generateAsync(input: {
    text: string;
    generationConfig: { sid: number; speed: number; silenceScale: number };
  }): Promise<GeneratedAudio>;
}

interface RealtimeTranscriber {
  setSampleRate(sampleRate: number): void;
  setMode(mode: 'standby' | 'active'): void;
  accept(samples: Float32Array): void;
  finishTurn(): void;
  close(): void;
  onTranscript?: (text: string) => void;
  onWake?: () => void;
}

interface SherpaModule {
  OnlineRecognizer: new (config: object) => OnlineRecognizer;
  KeywordSpotter: new (config: object) => KeywordSpotter;
  OfflineTts: {
    createAsync(config: object): Promise<OfflineTts>;
  };
}

let sherpa: SherpaModule | null = null;
try {
  const localRequire = createRequire(__filename);
  try {
    sherpa = localRequire('sherpa-onnx-node') as SherpaModule;
  } catch {
    sherpa = localRequire('/app/node_modules/sherpa-onnx-node') as SherpaModule;
  }
} catch (loadError) {
  // eslint-disable-next-line no-console
  console.warn(
    '[speech] sherpa-onnx-node native binary unavailable, operating in online mode:',
    loadError,
  );
}

const PORT = Number(process.env.SPEECH_PORT ?? 6010);
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY?.trim() ?? '';
const MINIMAX_REALTIME_MODEL = process.env.MINIMAX_REALTIME_MODEL?.trim() || 'abab6.5s-chat';
const MINIMAX_REALTIME_VOICE = process.env.MINIMAX_REALTIME_VOICE?.trim() || 'female-shaonv';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN?.trim() ?? '';
const runtimeMetrics = createSpeechRuntimeMetrics();
const MODEL_ROOT = process.env.SPEECH_MODEL_ROOT
  ? path.resolve(process.env.SPEECH_MODEL_ROOT)
  : path.resolve(__dirname, '../../../local-models');
const ASR_DIR = path.join(MODEL_ROOT, 'sherpa-onnx-streaming-paraformer-bilingual-zh-en');
const KWS_DIR = path.join(MODEL_ROOT, 'sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01');
const TTS_DIR = path.join(MODEL_ROOT, 'kokoro-int8-multi-lang-v1_1');
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
]);

function requiredFile(...segments: string[]): string {
  const filename = path.join(...segments);
  if (!existsSync(filename)) {
    throw new Error(
      `Missing local speech model file: ${filename}. Run pnpm --filter @xz/speech setup:model`,
    );
  }
  return filename;
}

let recognizer: OnlineRecognizer | null = null;
let keywordSpotter: KeywordSpotter | null = null;

if (sherpa && existsSync(ASR_DIR) && existsSync(KWS_DIR)) {
  try {
    recognizer = new sherpa.OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        paraformer: {
          encoder: requiredFile(ASR_DIR, 'encoder.int8.onnx'),
          decoder: requiredFile(ASR_DIR, 'decoder.int8.onnx'),
        },
        tokens: requiredFile(ASR_DIR, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
      },
      decodingMethod: 'greedy_search',
      maxActivePaths: 4,
      enableEndpoint: true,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 2.2,
      rule3MinUtteranceLength: 15,
    });

    keywordSpotter = new sherpa.KeywordSpotter({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: requiredFile(KWS_DIR, 'encoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx'),
          decoder: requiredFile(KWS_DIR, 'decoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx'),
          joiner: requiredFile(KWS_DIR, 'joiner-epoch-99-avg-1-chunk-16-left-64.int8.onnx'),
        },
        tokens: requiredFile(KWS_DIR, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
      },
      keywordsFile: requiredFile(KWS_DIR, 'keywords.txt'),
      maxActivePaths: 2,
      keywordsScore: 1.8,
      keywordsThreshold: 0.2,
      numTrailingBlanks: 1,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[speech] Local speech models skipped:', err);
  }
}

let tts: OfflineTts | null = null;
let ttsQueue: Promise<void> = Promise.resolve();
const ttsCache = new Map<string, Buffer>();
const MAX_TTS_CACHE_ENTRIES = 32;

async function loadTts(): Promise<void> {
  if (!sherpa || !existsSync(path.join(TTS_DIR, 'model.int8.onnx'))) return;
  tts = await sherpa.OfflineTts.createAsync({
    model: {
      kokoro: {
        model: requiredFile(TTS_DIR, 'model.int8.onnx'),
        voices: requiredFile(TTS_DIR, 'voices.bin'),
        tokens: requiredFile(TTS_DIR, 'tokens.txt'),
        dataDir: requiredFile(TTS_DIR, 'espeak-ng-data'),
        dictDir: requiredFile(TTS_DIR, 'dict'),
        lexicon: [
          path.join(TTS_DIR, 'lexicon-us-en.txt'),
          path.join(TTS_DIR, 'lexicon-zh.txt'),
        ].join(','),
        lang: 'zh',
      },
      numThreads: 2,
      debug: false,
      provider: 'cpu',
    },
    maxNumSentences: 1,
    silenceScale: 0.2,
  });
}

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (origin.includes('busybeeenglish.site')) return true;
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true;
  return false;
}

function sendJson(socket: WebSocket, value: object): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function toFloat32(data: RawData): Float32Array {
  const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
  const copy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Float32Array(copy);
}

function handleAsrConnection(socket: WebSocket): void {
  if (!recognizer) {
    sendJson(socket, { type: 'error', message: 'Local ASR engine unavailable' });
    socket.close();
    return;
  }
  const stream = recognizer.createStream();
  let sampleRate = 48000;
  let lastPartial = '';
  let closed = false;

  sendJson(socket, { type: 'ready', engine: 'funasr-paraformer', mode: 'continuous-streaming' });

  const emitPartial = (): void => {
    const text = recognizer.getResult(stream).text.trim();
    if (text && text !== lastPartial) {
      lastPartial = text;
      sendJson(socket, { type: 'partial', text });
    }
  };

  const finishUtterance = (): void => {
    const text = recognizer.getResult(stream).text.trim();
    if (text) sendJson(socket, { type: 'final', text });
    lastPartial = '';
    // 句末只重置模型状态，WebSocket 与麦克风保持不动，下一句话直接继续进入同一条流。
    recognizer.reset(stream);
  };

  socket.on('message', (data, isBinary) => {
    try {
      if (!isBinary) {
        const message = JSON.parse(data.toString()) as { type?: string; sampleRate?: number };
        if (message.type === 'start' && Number.isFinite(message.sampleRate)) {
          sampleRate = Math.max(8000, Math.min(96000, Math.round(message.sampleRate ?? 48000)));
        } else if (message.type === 'finish' && !closed) {
          stream.inputFinished();
          while (recognizer.isReady(stream)) recognizer.decode(stream);
          const text = recognizer.getResult(stream).text.trim();
          if (text) sendJson(socket, { type: 'final', text });
          closed = true;
        }
        return;
      }
      if (closed) return;
      const samples = toFloat32(data);
      if (samples.length === 0) return;
      stream.acceptWaveform({ samples, sampleRate });
      while (recognizer.isReady(stream)) recognizer.decode(stream);
      emitPartial();
      if (recognizer.isEndpoint(stream)) finishUtterance();
    } catch (error) {
      sendJson(socket, {
        type: 'error',
        message: error instanceof Error ? error.message : 'ASR failed',
      });
    }
  });

  socket.on('close', () => {
    closed = true;
  });
}

function createRealtimeTranscriber(
  socket: WebSocket,
  onTranscript?: (text: string) => void,
): RealtimeTranscriber {
  if (!recognizer || !keywordSpotter) {
    return {
      setSampleRate() {},
      setMode() {},
      accept() {},
      finishTurn() {},
      close() {},
    };
  }
  const stream = recognizer.createStream();
  const keywordStream = keywordSpotter.createStream();
  let sampleRate = 48000;
  let lastPartial = '';
  let closed = false;
  let mode: 'standby' | 'active' = 'standby';

  const transcriber: RealtimeTranscriber = {
    setSampleRate(nextRate) {
      sampleRate = Math.max(8000, Math.min(96000, Math.round(nextRate)));
    },
    setMode(nextMode) {
      if (mode === nextMode) return;
      mode = nextMode;
      lastPartial = '';
      recognizer.reset(stream);
      keywordSpotter.reset(keywordStream);
    },
    accept(samples) {
      if (closed || samples.length === 0) return;
      if (mode === 'standby') {
        keywordStream.acceptWaveform({ samples, sampleRate });
        while (keywordSpotter.isReady(keywordStream)) keywordSpotter.decode(keywordStream);
        const keyword = keywordSpotter.getResult(keywordStream).keyword?.trim();
        if (keyword) {
          keywordSpotter.reset(keywordStream);
          transcriber.onWake?.();
        }
      }
      if (mode !== 'active') return;
      stream.acceptWaveform({ samples, sampleRate });
      while (recognizer.isReady(stream)) recognizer.decode(stream);
      const text = recognizer.getResult(stream).text.trim();
      if (text && text !== lastPartial) {
        lastPartial = text;
        sendJson(socket, { type: 'partial', text });
      }
      // 实时链路只有浏览器 VAD 的 commit 可以结束一轮。
      // 不在这里再用 Paraformer endpoint 自动提交，避免两套端点检测各自触发一次业务任务。
    },
    finishTurn() {
      if (!closed && mode === 'active') emitFinal();
    },
    close() {
      if (closed) return;
      closed = true;
      stream.inputFinished();
      while (recognizer.isReady(stream)) recognizer.decode(stream);
      const text = recognizer.getResult(stream).text.trim();
      if (text && socket.readyState === WebSocket.OPEN) transcriber.onTranscript?.(text);
    },
  };

  function emitFinal(): void {
    if (!recognizer) return;
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    const text = recognizer.getResult(stream).text.trim();
    if (text) {
      onTranscript?.(text);
      transcriber.onTranscript?.(text);
    }
    lastPartial = '';
    recognizer.reset(stream);
  }

  return transcriber;
}

function applyCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (!originAllowed(origin)) {
    response.writeHead(403).end();
    return false;
  }
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  return true;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > 8192) throw new Error('Request is too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function wavFromFloat32(samples: Float32Array, sampleRate: number): Buffer {
  const output = Buffer.allocUnsafe(44 + samples.length * 2);
  output.write('RIFF', 0);
  output.writeUInt32LE(output.length - 8, 4);
  output.write('WAVE', 8);
  output.write('fmt ', 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    output.writeInt16LE(Math.round(sample < 0 ? sample * 32768 : sample * 32767), 44 + index * 2);
  }
  return output;
}

async function synthesize(text: string): Promise<Buffer> {
  if (!tts) throw new Error('Local TTS model is not ready');
  const cached = ttsCache.get(text);
  if (cached) {
    ttsCache.delete(text);
    ttsCache.set(text, cached);
    return cached;
  }
  let resolveAudio: (audio: Buffer) => void = () => undefined;
  let rejectAudio: (error: unknown) => void = () => undefined;
  const result = new Promise<Buffer>((resolve, reject) => {
    resolveAudio = resolve;
    rejectAudio = reject;
  });
  ttsQueue = ttsQueue.then(async () => {
    try {
      const audio = await tts?.generateAsync({
        text,
        generationConfig: { sid: 8, speed: 1.2, silenceScale: 0.15 },
      });
      if (!audio) throw new Error('TTS returned no audio');
      const wav = wavFromFloat32(audio.samples, audio.sampleRate);
      ttsCache.set(text, wav);
      if (ttsCache.size > MAX_TTS_CACHE_ENTRIES) {
        const oldest = ttsCache.keys().next().value as string | undefined;
        if (oldest) ttsCache.delete(oldest);
      }
      resolveAudio(wav);
    } catch (error) {
      rejectAudio(error);
    }
  });
  return result;
}

const server = createServer(async (request, response) => {
  if (!applyCors(request, response)) return;
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    (request.url === '/health' || request.url === '/')
  ) {
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        ok: true,
        wake_word: 'sherpa-onnx-kws 小知小知',
        asr: 'paraformer-after-wake',
        tts: tts ? 'local-kokoro' : 'system-fallback',
        realtime: MINIMAX_API_KEY ? 'minimax-configured' : 'not-configured',
      }),
    );
    return;
  }
  if (request.method === 'GET' && request.url === '/metrics') {
    if (!ADMIN_TOKEN || request.headers['x-admin-token'] !== ADMIN_TOKEN) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(runtimeMetrics.snapshot()));
    return;
  }
  if (request.method === 'POST' && request.url === '/tts') {
    try {
      const body = (await readJson(request)) as { text?: unknown };
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > 500) throw new Error('Text must contain 1-500 characters');
      const audio = await synthesize(text);
      response.setHeader('Content-Type', 'audio/wav');
      response.setHeader('Content-Length', String(audio.length));
      response.end(audio);
    } catch (error) {
      response.statusCode = tts ? 400 : 503;
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({ error: error instanceof Error ? error.message : 'TTS failed' }),
      );
    }
    return;
  }
  response.writeHead(404).end();
});

const asrSockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
const realtimeSockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
asrSockets.on('connection', handleAsrConnection);
realtimeSockets.on('connection', (socket) => {
  runtimeMetrics.connectionOpened();
  const transcriber = createRealtimeTranscriber(socket, (text) => {
    void text;
  });
  handleMiniMaxRealtime(socket, {
    apiKey: MINIMAX_API_KEY,
    model: MINIMAX_REALTIME_MODEL,
    voice: MINIMAX_REALTIME_VOICE,
    preferLocalTranscript: Boolean(recognizer),
    onTranscript: (text) => sendJson(socket, { type: 'transcript', text }),
    debug: process.env.MINIMAX_REALTIME_DEBUG === 'true',
    transcriber,
    metrics: runtimeMetrics,
  });
});
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    .pathname;
  if (!originAllowed(request.headers.origin)) {
    socket.destroy();
    return;
  }
  if (pathname === '/asr') {
    asrSockets.handleUpgrade(request, socket, head, (webSocket) =>
      asrSockets.emit('connection', webSocket, request),
    );
  } else if (pathname === '/realtime') {
    realtimeSockets.handleUpgrade(request, socket, head, (webSocket) =>
      realtimeSockets.emit('connection', webSocket, request),
    );
  } else {
    socket.destroy();
  }
});

void loadTts()
  .catch((error) =>
    process.stderr.write(
      `${JSON.stringify({ level: 'error', msg: 'speech.tts_load_failed', error: String(error) })}\n`,
    ),
  )
  .finally(() => {
    server.listen(PORT, '0.0.0.0', () => {
      process.stdout.write(
        `${JSON.stringify({ msg: 'speech.started', port: PORT, wake_word: 'sherpa-onnx-kws', asr: 'after-wake', tts: tts ? 'kokoro' : 'system-fallback', realtime: MINIMAX_API_KEY ? 'minimax' : 'disabled' })}\n`,
      );
    });
  });
