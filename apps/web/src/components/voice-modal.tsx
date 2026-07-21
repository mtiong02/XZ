'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { unitLabel } from '../lib/format';
import {
  cancelVoiceJob,
  confirmVoiceJob,
  createTextVoiceJob,
  type VoiceJob,
} from '../lib/voice-api';

interface Props {
  householdId: string;
  onClose: () => void;
  onDone: () => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  AMBIGUOUS_COMMAND: '没听清是要做什么，请换种说法，例如「买了两盒牛奶」。',
};

const COMMAND_LABELS: Record<string, string> = {
  ADD_INVENTORY: '添加',
  CONSUME_INVENTORY: '使用',
  DISCARD_INVENTORY: '丢弃',
  QUERY_INVENTORY: '查询',
};

type Stage = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'AWAITING_CONFIRMATION' | 'DONE' | 'ERROR';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/**
 * 语音输入弹窗（docs/01 §7.2 状态机）。
 * 使用浏览器 Web Speech API 做识别，文本进入服务端解析流水线；
 * 库存写操作必须经确认卡片，不静默执行（AGENTS.md §2）。
 * 浏览器不支持时降级为手动文本输入。
 */
export function VoiceModal({ householdId, onClose, onDone }: Props) {
  const [stage, setStage] = useState<Stage>('IDLE');
  const [transcript, setTranscript] = useState('');
  const [manualText, setManualText] = useState('');
  const [job, setJob] = useState<VoiceJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    setSpeechSupported(Boolean(Ctor));
  }, []);

  const submitText = useCallback(
    async (text: string, channel: string) => {
      setStage('PROCESSING');
      setBusy(true);
      setError(null);
      try {
        const result = await createTextVoiceJob(householdId, text, channel);
        setJob(result);
        if (result.status === 'AWAITING_CONFIRMATION') {
          setStage('AWAITING_CONFIRMATION');
        } else if (result.status === 'COMPLETED') {
          setStage('DONE');
        } else {
          setStage('ERROR');
          setError(
            result.error_code
              ? (ERROR_MESSAGES[result.error_code] ?? `解析失败：${result.error_code}`)
              : '解析失败',
          );
        }
      } catch (e) {
        setStage('ERROR');
        setError(e instanceof Error ? e.message : '请求失败');
      } finally {
        setBusy(false);
      }
    },
    [householdId],
  );

  function startListening() {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setSpeechSupported(false);
      return;
    }
    const recognition = new Ctor();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const text = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? '')
        .join('');
      setTranscript(text);
    };
    recognition.onerror = (event) => {
      setStage('ERROR');
      setError(`录音失败：${event.error}`);
    };
    recognition.onend = () => {
      setTranscript((current) => {
        if (current.trim()) {
          void submitText(current.trim(), 'WEB_VOICE');
        } else {
          setStage('IDLE');
        }
        return current;
      });
    };
    recognitionRef.current = recognition;
    setTranscript('');
    setStage('LISTENING');
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  async function confirm() {
    if (!job) return;
    setBusy(true);
    try {
      await confirmVoiceJob(job.voice_job_id);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : '执行失败');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (job) await cancelVoiceJob(job.voice_job_id).catch(() => undefined);
    onClose();
  }

  const candidate = job?.candidate_command;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>🎤 语音操作</h3>

        {stage === 'IDLE' ? (
          <>
            {speechSupported ? (
              <div style={{ textAlign: 'center', margin: '20px 0' }}>
                <button className="primary" onClick={startListening} style={{ width: '100%' }}>
                  按住说话 / 点击开始
                </button>
                <p style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 10 }}>
                  例如：「刚买了两盒牛奶和十个鸡蛋」
                </p>
              </div>
            ) : null}
            <div className="field" style={{ marginTop: speechSupported ? 12 : 0 }}>
              <label htmlFor="manual-voice">
                {speechSupported ? '或直接输入文字' : '输入你要执行的操作'}
              </label>
              <input
                id="manual-voice"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="例如：用了2个鸡蛋"
              />
            </div>
            <div className="actions">
              <button onClick={onClose}>取消</button>
              <button
                className="primary"
                disabled={!manualText.trim() || busy}
                onClick={() => submitText(manualText.trim(), 'WEB_MANUAL')}
              >
                识别
              </button>
            </div>
          </>
        ) : null}

        {stage === 'LISTENING' ? (
          <div style={{ textAlign: 'center', margin: '20px 0' }}>
            <p style={{ fontSize: 40 }}>🔴</p>
            <p style={{ minHeight: 24 }}>{transcript || '正在聆听…'}</p>
            <button className="primary" onClick={stopListening} style={{ marginTop: 12 }}>
              完成
            </button>
          </div>
        ) : null}

        {stage === 'PROCESSING' ? <div className="empty">识别中…</div> : null}

        {stage === 'AWAITING_CONFIRMATION' && candidate ? (
          <>
            <div className="confirm-card">
              {job?.transcript ? (
                <div className="row">
                  <span>识别文本</span>
                  <span>「{job.transcript.raw}」</span>
                </div>
              ) : null}
              <div className="row">
                <span>操作</span>
                <strong>{COMMAND_LABELS[candidate.command_type] ?? candidate.command_type}</strong>
              </div>
              {candidate.payload.items?.map((item, index) => (
                <div className="row" key={index}>
                  <span>{item.display_text ?? '食材'}</span>
                  <strong>
                    {item.quantity} {unitLabel(item.unit)}
                  </strong>
                </div>
              ))}
              {job?.confidence ? (
                <div className="row">
                  <span>置信度</span>
                  <span>{Math.round(job.confidence.overall * 100)}%</span>
                </div>
              ) : null}
            </div>
            {error ? <div className="error-box">{error}</div> : null}
            <div className="actions">
              <button onClick={cancel}>取消</button>
              <button className="primary" disabled={busy} onClick={confirm}>
                {busy ? '执行中…' : '确认执行'}
              </button>
            </div>
          </>
        ) : null}

        {stage === 'DONE' ? (
          <div className="empty">
            <p style={{ fontSize: 32 }}>✅</p>
            <p>完成</p>
            <button className="primary" onClick={onDone} style={{ marginTop: 12 }}>
              好
            </button>
          </div>
        ) : null}

        {stage === 'ERROR' ? (
          <>
            {error ? <div className="error-box">{error}</div> : null}
            <div className="actions">
              <button onClick={onClose}>关闭</button>
              <button
                className="primary"
                onClick={() => {
                  setStage('IDLE');
                  setError(null);
                  setJob(null);
                }}
              >
                重试
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
