'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isAsrSupported, listenOnce, type AsrHandle } from '../lib/asr';
import { getTts } from '../lib/tts';
import {
  cancelVoiceJob,
  createTextVoiceJob,
  isAwaitingReply,
  replyVoiceJob,
  type VoiceJob,
} from '../lib/voice-api';

interface Props {
  householdId: string;
  onClose: () => void;
  onExecuted: () => void;
}

type Phase = 'idle' | 'listening' | 'processing' | 'speaking' | 'done';

interface Message {
  role: 'user' | 'system';
  text: string;
}

/**
 * 连续语音对话（docs/09）。
 * 循环：听你说 → 识别 → 系统播报确认 → 听你回"对/不对/改成…" → …直到执行或取消。
 * ASR 用浏览器 Web Speech（真机端上），TTS 用 Kokoro（懒加载）+ 内置兜底。
 * 无麦克风时自动降级为逐轮文字输入 + 快捷按钮，流程一致。
 */
export function ConversationModal({ householdId, onClose, onExecuted }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [interim, setInterim] = useState('');
  const [manualText, setManualText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [asrSupported] = useState(() => isAsrSupported());

  const jobRef = useRef<VoiceJob | null>(null);
  const asrRef = useRef<AsrHandle | null>(null);
  const closedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 打破 handleJob <-> sendReply 的循环依赖：始终指向最新的 sendReply
  const sendReplyRef = useRef<(text: string) => void>(() => undefined);

  useEffect(() => {
    // 后台预载 Kokoro，不阻塞对话
    getTts().preload();
    return () => {
      closedRef.current = true;
      asrRef.current?.stop();
      getTts().stop();
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, interim]);

  const pushMessage = useCallback((role: 'user' | 'system', text: string) => {
    setMessages((prev) => [...prev, { role, text }]);
  }, []);

  // 监听用户一个回合（识别到文本后交给 handler）
  const listen = useCallback(
    (onText: (text: string) => void) => {
      if (!asrSupported) {
        // 无 ASR：等待用户在输入框回复
        setPhase('listening');
        return;
      }
      setInterim('');
      setError(null);
      setPhase('listening');
      asrRef.current = listenOnce({
        onInterim: (t) => setInterim(t),
        onFinal: (t) => {
          setInterim('');
          onText(t);
        },
        onError: (e) => {
          setInterim('');
          // 没听到/被拒 → 回落到文字输入，流程不中断
          if (e === 'not-allowed' || e === 'not-supported') {
            setError('麦克风不可用，请在下方输入文字继续。');
          }
          setPhase('listening');
        },
      });
    },
    [asrSupported],
  );

  // 处理服务端返回的任务：播报系统话 → 终态立即结束（后台播报），等待回应则说完再听
  const handleJob = useCallback(
    async (job: VoiceJob) => {
      jobRef.current = job;
      const terminal =
        job.status === 'COMPLETED' || job.status === 'CANCELLED' || job.status === 'FAILED';

      if (job.spoken_prompt) {
        pushMessage('system', job.spoken_prompt);
        if (terminal) {
          // 终态不阻塞 UI：结果气泡已显示，语音在后台播报
          void getTts().speak(job.spoken_prompt);
        } else {
          // 等待回应前先把话说完，避免听到自己的声音（带超时，绝不卡死）
          setPhase('speaking');
          await getTts().speak(job.spoken_prompt);
        }
      }
      if (closedRef.current) return;

      if (terminal) {
        // 终态：停掉任何残留的识别，避免其 onend 事件把状态改回聆听/识别中
        asrRef.current?.stop();
        setPhase('done');
        if (job.status === 'COMPLETED') onExecuted();
        return;
      }
      if (isAwaitingReply(job.status)) {
        // 继续听下一轮回应
        listen((text) => void sendReplyRef.current(text));
      }
    },
    [listen, onExecuted, pushMessage],
  );

  const sendFirst = useCallback(
    async (text: string) => {
      setError(null);
      pushMessage('user', text);
      setPhase('processing');
      try {
        const job = await createTextVoiceJob(householdId, text, 'WEB_VOICE');
        await handleJob(job);
      } catch (e) {
        setError(e instanceof Error ? e.message : '请求失败');
        setPhase('idle');
      }
    },
    [householdId, handleJob, pushMessage],
  );

  const sendReply = useCallback(
    async (text: string) => {
      const job = jobRef.current;
      if (!job) return;
      setError(null);
      pushMessage('user', text);
      setPhase('processing');
      try {
        const next = await replyVoiceJob(job.voice_job_id, text);
        await handleJob(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : '请求失败');
        setPhase('listening');
      }
    },
    [handleJob, pushMessage],
  );
  sendReplyRef.current = (text: string) => void sendReply(text);

  const start = useCallback(() => {
    setMessages([]);
    setError(null);
    jobRef.current = null;
    listen((text) => void sendFirst(text));
  }, [listen, sendFirst]);

  function submitManual() {
    const text = manualText.trim();
    if (!text) return;
    setManualText('');
    asrRef.current?.stop();
    if (jobRef.current && isAwaitingReply(jobRef.current.status)) {
      void sendReply(text);
    } else {
      void sendFirst(text);
    }
  }

  async function quickReply(text: string) {
    asrRef.current?.stop();
    await sendReply(text);
  }

  async function endConversation() {
    asrRef.current?.stop();
    getTts().stop();
    const job = jobRef.current;
    if (job && isAwaitingReply(job.status)) {
      await cancelVoiceJob(job.voice_job_id).catch(() => undefined);
    }
    onClose();
  }

  const awaiting = jobRef.current ? isAwaitingReply(jobRef.current.status) : false;

  const phaseLabel: Record<Phase, string> = {
    idle: asrSupported ? '点击开始，然后说话' : '在下方输入开始',
    listening: interim ? interim : '在听你说…',
    processing: '识别中…',
    speaking: '播报中…',
    done: '完成',
  };

  return (
    <div className="modal-backdrop" onClick={endConversation}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>🎙️ 语音对话</h3>
          <button className="ghost" onClick={endConversation}>
            关闭
          </button>
        </div>

        <div
          ref={scrollRef}
          style={{
            minHeight: 180,
            maxHeight: 320,
            overflowY: 'auto',
            background: 'var(--gray-50)',
            borderRadius: 12,
            padding: 12,
            margin: '10px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {messages.length === 0 ? (
            <p style={{ color: 'var(--gray-500)', textAlign: 'center', margin: 'auto' }}>
              例如说：「加两盒牛奶」，我会复述确认，你回「对」或「不是，三盒」。
            </p>
          ) : null}
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                background: m.role === 'user' ? 'var(--green)' : '#fff',
                color: m.role === 'user' ? '#fff' : 'var(--gray-900)',
                border: m.role === 'user' ? 'none' : '1px solid var(--gray-200)',
                borderRadius: 12,
                padding: '8px 12px',
                fontSize: 15,
              }}
            >
              {m.text}
            </div>
          ))}
          {interim ? (
            <div
              style={{
                alignSelf: 'flex-end',
                maxWidth: '80%',
                background: 'var(--green-bg)',
                color: 'var(--gray-600)',
                borderRadius: 12,
                padding: '8px 12px',
                fontSize: 15,
              }}
            >
              {interim}
            </div>
          ) : null}
        </div>

        <div
          style={{
            textAlign: 'center',
            fontSize: 13,
            color: phase === 'listening' ? 'var(--green-dark)' : 'var(--gray-500)',
            minHeight: 20,
          }}
        >
          {phase === 'listening' ? '🔴 ' : ''}
          {phaseLabel[phase]}
        </div>

        {error ? <div className="error-box">{error}</div> : null}

        {phase === 'idle' && messages.length === 0 ? (
          <button className="primary" style={{ width: '100%' }} onClick={start}>
            {asrSupported ? '开始对话' : '开始（输入文字）'}
          </button>
        ) : null}

        {awaiting ? (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button className="primary" style={{ flex: 1 }} onClick={() => void quickReply('对')}>
              ✓ 对
            </button>
            <button style={{ flex: 1 }} onClick={() => void quickReply('不对')}>
              ✕ 不对
            </button>
          </div>
        ) : null}

        {phase === 'done' ? (
          <button className="primary" style={{ width: '100%' }} onClick={onClose}>
            好
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{
                flex: 1,
                padding: '10px 12px',
                border: '1px solid var(--gray-200)',
                borderRadius: 8,
                fontSize: 15,
              }}
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitManual();
              }}
              placeholder={awaiting ? '也可以输入：不是，三盒' : '也可以输入：加两盒牛奶'}
            />
            <button className="primary" disabled={!manualText.trim()} onClick={submitManual}>
              发送
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
