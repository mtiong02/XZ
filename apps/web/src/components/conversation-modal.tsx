'use client';

import Image from 'next/image';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { startRealtimeVoice, type RealtimeVoiceHandle } from '../lib/realtime-voice';
import {
  cancelVoiceJob,
  createTextVoiceJob,
  isAwaitingReply,
  replyVoiceJob,
  type VoiceJob,
} from '../lib/voice-api';

interface Props {
  householdId: string;
  expanded: boolean;
  onOpen: () => void;
  onClose: () => void;
  onExecuted: () => void;
  onAddInventory: () => void;
  onConsumeInventory: () => void;
  dailyBriefing?: { text: string; should_speak: boolean; scheduled_time: string } | null;
  scheduledReminders?: Array<{ id: string; text: string; scheduled_for: string }>;
}

type Phase = 'idle' | 'standby' | 'listening' | 'processing' | 'speaking';
type SpeechSource = 'online-audio' | 'manual';

interface Message {
  role: 'user' | 'system';
  text: string;
}

interface MascotPosition {
  x: number;
  y: number;
}

function normalizedSpeech(text: string): string {
  return text.toLowerCase().replace(/[\s，。！？、,.!?：:；;"“”'‘’]/g, '');
}

function stripWakePhrase(text: string): string {
  return text
    .replace(
      /[小晓少]\s*[知智资芝滋咨子值字只之尺]+\s*[小晓少](?:\s*[知智资芝滋咨子值字只之尺]+)?/gi,
      '',
    )
    .trim();
}

function correctInventoryHomophones(text: string): string {
  return text.replace(/([零一二两三四五六七八九十百\d]+)[和合河核](?=$|[\s，。,.])/g, '$1盒');
}

function isLikelySpeakerEcho(heard: string, spoken: string): boolean {
  const heardText = normalizedSpeech(heard);
  const spokenText = normalizedSpeech(spoken);
  if (heardText.length < 4 || spokenText.length < 4) return false;
  return spokenText.includes(heardText) || heardText.includes(spokenText);
}

/** 在库存/闲聊路由之前识别结束词，避免“好的谢谢结束”被模型当作普通聊天。 */
function isDialogueExit(text: string): boolean {
  const compact = normalizedSpeech(text);
  if (/结束后提醒/.test(compact)) return false;
  const courtesy = '(?:谢谢(?:力|你|啦)?|多谢|辛苦了|麻烦你了|拜拜|再见|晚安|了|吧)*';

  if (/^(?:(?:好(?:的)?)?(?:结束|退出|关闭|停止|取消|拜拜|再见|退下)(?:这段|本次|当前)?(?:对话|对换|兑换|绘话|会话|聊天|谈话|通话|对|聊|会|吧|了|谢谢)*)+$/i.test(compact)) {
    return true;
  }

  return (
    new RegExp(
      `^(?:好(?:的)?|那|嗯|啊|行|可以)?(?:我(?:们)?(?:要|想|先)?|请)?(?:(?:结束|退出|关闭|停止)(?:这段|本次|当前)?(?:对话|对换|兑换|绘话|会话|聊天|谈话|通话|对|聊|会)?${courtesy})+$`,
      'i',
    ).test(compact) ||
    new RegExp(
      `^(?:好(?:的)?|那|嗯|啊|行|可以)?(?:(?:我们|咱们|我)(?:今天)?(?:就|先)?|今天)?(?:就|先)?(?:先这样|就这样|到这(?:里)?|先到这(?:里)?|没事了|没有别的了|不聊了|下次再聊|回头再聊|我先走了|我先忙了|先挂了|挂了|结束吧|退下吧|先退下|你先退下|拜拜|再见|晚安)${courtesy}$`,
      'i',
    ).test(compact) ||
    new RegExp(
      `^(?:好(?:的)?|那|嗯|啊)?(?:(?:先)?(?:别|不要|不用)(?:再|继续)?(?:听|收音|说|说话|聊天|聊|回答|播报)|(?:不用|不需要)再(?:听|收音|说|说话|聊天|聊|回答|播报))${courtesy}$`,
      'i',
    ).test(compact) ||
    new RegExp(`^(?:好(?:的)?)?(?:谢谢(?:你|啦)?|多谢)?(?:结束|退出)${courtesy}$`, 'i').test(compact) ||
    new RegExp(`^(?:结束|退出|取消|算了|不用了|不加了)(?:对话|会话|对换|聊天|谈话|通话|谢谢|吧|了)?${courtesy}$`, 'i').test(compact)
  );
}

/** 一次打开麦克风后持续收音；句末不重连，播报期间也可说话打断。 */
export function ConversationModal({
  householdId,
  expanded,
  onOpen,
  onClose,
  onExecuted,
  onAddInventory,
  onConsumeInventory,
  dailyBriefing,
  scheduledReminders = [],
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [interim, setInterim] = useState('');
  const [manualText, setManualText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState<'online' | null>(null);
  const [mascotPosition, setMascotPosition] = useState<MascotPosition | null>(null);
  const [mascotDragging, setMascotDragging] = useState(false);

  const jobRef = useRef<VoiceJob | null>(null);
  const realtimeRef = useRef<RealtimeVoiceHandle | null>(null);
  const closedRef = useRef(false);
  const speakingRef = useRef(false);
  const sessionEndingRef = useRef(false);
  const handlingRef = useRef(false);
  const queuedTextRef = useRef<string | null>(null);
  const lastPromptRef = useRef('');
  const lastDispatchRef = useRef<{ normalized: string; at: number } | null>(null);
  const dispatchRef = useRef<(text: string, source?: SpeechSource) => void>(() => undefined);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const reminderTimersRef = useRef<number[]>([]);
  const startRef = useRef<() => Promise<void>>(async () => undefined);
  const mascotRef = useRef<HTMLDivElement | null>(null);
  const suppressMascotClickRef = useRef(false);
  const mascotDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  const clampMascotPosition = useCallback((position: MascotPosition): MascotPosition => {
    const rect = mascotRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 276;
    const height = rect?.height ?? 82;
    const edge = 10;
    const navigationSpace = window.innerWidth <= 680 ? 76 : edge;
    return {
      x: Math.min(Math.max(position.x, edge), Math.max(edge, window.innerWidth - width - edge)),
      y: Math.min(
        Math.max(position.y, edge),
        Math.max(edge, window.innerHeight - height - navigationSpace),
      ),
    };
  }, []);

  useEffect(() => {
    const storageKey = `xz-mascot-position:${householdId}`;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) {
        setMascotPosition(null);
        return;
      }
      const parsed = JSON.parse(stored) as Partial<MascotPosition>;
      if (
        typeof parsed.x === 'number' &&
        Number.isFinite(parsed.x) &&
        typeof parsed.y === 'number' &&
        Number.isFinite(parsed.y)
      ) {
        setMascotPosition(clampMascotPosition({ x: parsed.x, y: parsed.y }));
      }
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [clampMascotPosition, householdId]);

  useEffect(() => {
    const handleResize = () => {
      setMascotPosition((current) => (current ? clampMascotPosition(current) : current));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampMascotPosition]);

  const stopListening = useCallback(() => {
    realtimeRef.current?.stop();
    realtimeRef.current = null;
    reminderTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    reminderTimersRef.current = [];
  }, []);

  const abandonPendingJob = useCallback(() => {
    const pending = jobRef.current;
    jobRef.current = null;
    queuedTextRef.current = null;
    if (!pending || !isAwaitingReply(pending.status)) return;
    void cancelVoiceJob(pending.voice_job_id).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : '取消当前语音任务失败');
    });
  }, []);

  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
      stopListening();
    };
  }, [stopListening]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, interim]);

  const pushMessage = useCallback((role: 'user' | 'system', text: string) => {
    setMessages((previous) => [...previous, { role, text }]);
  }, []);

  const handleJob = useCallback(
    async (job: VoiceJob) => {
      jobRef.current = job;
      const terminal =
        job.status === 'COMPLETED' || job.status === 'CANCELLED' || job.status === 'FAILED';

      if (job.spoken_prompt) {
        lastPromptRef.current = job.spoken_prompt;
        pushMessage('system', job.spoken_prompt);
        realtimeRef.current?.speakText(job.spoken_prompt);
        speakingRef.current = true;
        setPhase('speaking');
      }
      if (closedRef.current) return;

      if (terminal) {
        if (job.status === 'COMPLETED') onExecuted();
        jobRef.current = null;
      }
      if (!job.spoken_prompt) setPhase('listening');
    },
    [onExecuted, pushMessage],
  );

  const sendFirst = useCallback(
    async (text: string) => {
      pushMessage('user', text);
      setPhase('processing');
      return createTextVoiceJob(householdId, text, 'WEB_VOICE');
    },
    [householdId, pushMessage],
  );

  const sendReply = useCallback(
    async (job: VoiceJob, text: string) => {
      pushMessage('user', text);
      setPhase('processing');
      const next = await replyVoiceJob(job.voice_job_id, text);
      await handleJob(next);
    },
    [handleJob, pushMessage],
  );

  const dispatchRecognized = useCallback(
    async (rawText: string, source: SpeechSource = 'online-audio') => {
      const text = correctInventoryHomophones(stripWakePhrase(rawText.trim()));
      if (!text || closedRef.current) return;
      if (isDialogueExit(text)) {
        sessionEndingRef.current = true;
        abandonPendingJob();
        realtimeRef.current?.endSession();
        setInterim('正在结束本次对话…');
        setPhase('processing');
        return;
      }
      const normalized = normalizedSpeech(text);
      const now = Date.now();
      const lastDispatch = lastDispatchRef.current;
      if (lastDispatch && lastDispatch.normalized === normalized && now - lastDispatch.at < 2500)
        return;
      lastDispatchRef.current = { normalized, at: now };

      // MiniMax 可能在本地意图路由完成前自动开始回答。先停掉该响应；只有确认是
      // 普通闲聊后才显式重新请求，确保库存/提醒轮只有工具生成的一条最终答案。
      if (source === 'online-audio') realtimeRef.current?.cancelResponse();

      if (speakingRef.current && source !== 'online-audio') {
        if (isLikelySpeakerEcho(text, lastPromptRef.current)) {
          setInterim('');
          return;
        }
        // 用户在播报过程中说话：立即终止音频，TTS Promise 也同步释放。
        speakingRef.current = false;
      }

      if (handlingRef.current) {
        queuedTextRef.current = text;
        return;
      }

      handlingRef.current = true;
      let currentText: string | null = text;
      try {
        while (currentText && !closedRef.current) {
          setInterim('');
          setError(null);
          const currentJob = jobRef.current;
          if (currentJob && isAwaitingReply(currentJob.status)) {
            await sendReply(currentJob, currentText);
          } else {
            const next = await sendFirst(currentText);
            const shouldUseOnlineReply =
              realtimeRef.current !== null &&
              next.status === 'FAILED' &&
              next.error_code === 'AMBIGUOUS_COMMAND' &&
              next.candidate_command === null;
            if (shouldUseOnlineReply) {
              jobRef.current = null;
              realtimeRef.current?.sendText(currentText);
              realtimeRef.current?.respond();
              setPhase('processing');
            } else {
              await handleJob(next);
            }
          }
          currentText = queuedTextRef.current;
          queuedTextRef.current = null;
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '请求失败');
        setPhase('listening');
      } finally {
        handlingRef.current = false;
      }
    },
    [abandonPendingJob, handleJob, sendFirst, sendReply],
  );
  dispatchRef.current = (text: string, source: SpeechSource = 'online-audio') =>
    void dispatchRecognized(text, source);

  const start = useCallback(async () => {
    setMessages([]);
    setError(null);
    setInterim('');
    setVoiceMode(null);
    jobRef.current = null;
    queuedTextRef.current = null;
    setPhase('processing');
    stopListening();
    try {
      const realtime = await startRealtimeVoice({
        onReady: () => {
          setVoiceMode('online');
          setPhase('standby');
        },
        onListening: () => setPhase('processing'),
        onUserSpeechStart: () => {
          setInterim('正在听…');
          setPhase('listening');
        },
        onWake: () => {
          sessionEndingRef.current = false;
          setInterim('已唤醒，可以说话');
          setPhase('listening');
          speakingRef.current = false;
        },
        onStandby: () => {
          setInterim('');
          if (!speakingRef.current) setPhase('standby');
        },
        onSessionActive: () => {
          sessionEndingRef.current = false;
          setInterim('会话进行中，可以继续说');
          setPhase('listening');
        },
        onSessionEnding: () => {
          sessionEndingRef.current = true;
          abandonPendingJob();
          setInterim('正在结束本次对话…');
          setPhase('processing');
        },
        onSessionEnded: () => {
          sessionEndingRef.current = false;
          speakingRef.current = false;
          setInterim('已退下，喊“小知小知”再次唤醒');
          setPhase('standby');
        },
        onTranscript: (text) => {
          setInterim('');
          // 当处于待机 (standby) 状态时，必须先通过唤醒词唤醒，忽略普通非唤醒短语
          if (phase === 'standby') return;
          dispatchRef.current(text, 'online-audio');
        },
        onUserInterim: (text) => setInterim(text),
        onAssistantPartial: () => undefined,
        onAssistantFinal: (text) => {
          setInterim('');
          if (text) pushMessage('system', text);
        },
        onAudioStart: () => {
          speakingRef.current = true;
          setPhase('speaking');
        },
        onAudioDone: () => {
          speakingRef.current = false;
          setInterim('');
          if (sessionEndingRef.current) {
            sessionEndingRef.current = false;
            setInterim('已退下，喊“小知小知”再次唤醒');
            setPhase('standby');
          } else {
            setPhase('listening');
          }
        },
        onError: (message) => {
          setInterim('');
          setError(message);
        },
      });
      realtimeRef.current = realtime;
      if (dailyBriefing?.should_speak) {
        const today = new Date().toISOString().slice(0, 10);
        const storageKey = `xz-daily-briefing-${householdId}`;
        const [hours, minutes] = dailyBriefing.scheduled_time.split(':').map(Number);
        const now = new Date();
        if (
          window.localStorage.getItem(storageKey) !== today &&
          now.getHours() * 60 + now.getMinutes() >= (hours ?? 9) * 60 + (minutes ?? 0)
        ) {
          window.localStorage.setItem(storageKey, today);
          pushMessage('system', dailyBriefing.text);
          realtime.speakText(dailyBriefing.text);
        }
      }
      for (const reminder of scheduledReminders) {
        const delay = new Date(reminder.scheduled_for).getTime() - Date.now();
        if (delay > 86_400_000) continue;
        const storageKey = `xz-reminder-spoken-${reminder.id}`;
        if (window.localStorage.getItem(storageKey)) continue;
        reminderTimersRef.current.push(
          window.setTimeout(
            () => {
              if (!realtimeRef.current || window.localStorage.getItem(storageKey)) return;
              window.localStorage.setItem(storageKey, new Date().toISOString());
              const text = `提醒你：${reminder.text}`;
              pushMessage('system', text);
              realtimeRef.current.speakText(text);
            },
            Math.max(0, delay),
          ),
        );
      }
      return;
    } catch (onlineError) {
      if (closedRef.current) return;
      setError(onlineError instanceof Error ? onlineError.message : 'MiniMax 在线语音不可用');
      setPhase('idle');
    }
  }, [
    abandonPendingJob,
    dailyBriefing,
    householdId,
    pushMessage,
    scheduledReminders,
    stopListening,
  ]);
  startRef.current = start;

  useEffect(() => {
    if (!expanded) {
      stopListening();
      return;
    }
    const timer = window.setTimeout(() => void startRef.current(), 0);
    return () => window.clearTimeout(timer);
  }, [expanded, householdId, stopListening]);

  function submitManual(): void {
    const text = manualText.trim();
    if (!text) return;
    setManualText('');
    dispatchRef.current(text, 'manual');
  }

  function quickReply(text: string): void {
    dispatchRef.current(text, 'manual');
  }

  function handleMascotPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    mascotDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      x: rect.left,
      y: rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleMascotPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = mascotDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 5) return;
    drag.moved = true;
    const nextPosition = clampMascotPosition({
      x: drag.originX + deltaX,
      y: drag.originY + deltaY,
    });
    drag.x = nextPosition.x;
    drag.y = nextPosition.y;
    setMascotDragging(true);
    setMascotPosition(nextPosition);
  }

  function finishMascotDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = mascotDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    mascotDragRef.current = null;
    setMascotDragging(false);
    if (!drag.moved) return;
    suppressMascotClickRef.current = true;
    window.setTimeout(() => {
      suppressMascotClickRef.current = false;
    }, 0);
    try {
      window.localStorage.setItem(
        `xz-mascot-position:${householdId}`,
        JSON.stringify({ x: drag.x, y: drag.y }),
      );
    } catch {
      // 隐私模式下本地存储可能不可用；不影响本次拖动。
    }
  }

  const awaiting = jobRef.current ? isAwaitingReply(jobRef.current.status) : false;
  const phaseLabel: Record<Phase, string> = {
    idle: error ? '需要麦克风权限，点我重新连接' : '正在准备语音待机…',
    standby: '已待机，仅监听唤醒词“小知小知”',
    listening: interim || '等待唤醒：说“小知小知”',
    processing:
      interim || (voiceMode === null ? '正在连接在线实时语音…' : '正在理解；麦克风仍在收音'),
    speaking: interim ? `听到：${interim}` : '正在播报；说“小知小知”可打断',
  };

  const mascotStatus: Record<Phase, string> = {
    idle: error ? '点我开启麦克风' : '正在连接…',
    standby: '待机中 · 说“小知小知”唤醒',
    listening: interim || '随时待命 · 说“小知小知”',
    processing: interim || '正在理解…',
    speaking: '小知正在说话',
  };

  if (!expanded) {
    return (
      <div
        ref={mascotRef}
        className={`mascot-assistant mascot-${phase}${mascotDragging ? ' is-dragging' : ''}`}
        style={
          mascotPosition
            ? {
                left: mascotPosition.x,
                top: mascotPosition.y,
                right: 'auto',
                bottom: 'auto',
              }
            : undefined
        }
        onPointerDown={handleMascotPointerDown}
        onPointerMove={handleMascotPointerMove}
        onPointerUp={finishMascotDrag}
        onPointerCancel={finishMascotDrag}
        onDragStart={(event) => event.preventDefault()}
        aria-label="小知语音与库存快捷操作；按住可移动位置"
      >
        <button
          className="mascot-main"
          type="button"
          onClick={() => {
            if (suppressMascotClickRef.current) {
              suppressMascotClickRef.current = false;
              return;
            }
            if (phase === 'idle') void start();
            onOpen();
          }}
          aria-label="打开小知语音助手"
          title="点击和小知说话，按住可移动"
        >
          <span className="mascot-glow" aria-hidden="true" />
          <Image
            className="mascot-image"
            src="/mascot/xiaozhi.png"
            width={190}
            height={190}
            priority
            alt="小知语音助手"
          />
          <span className="mascot-copy">
            <strong>小知</strong>
            <small>{mascotStatus[phase]}</small>
          </span>
          <span className="mascot-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>
        <span className="mascot-inventory-actions" aria-label="库存快捷操作">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onAddInventory}
          >
            添加
          </button>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onConsumeInventory}
          >
            使用
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="conversation-header">
          <h3>和小知说话</h3>
          <div>
            <button className="ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="conversation-stream">
          {messages.length === 0 ? (
            <p className="conversation-empty">
              开始后不用再点按钮。说「加两盒牛奶」，播报时也可以直接说「不对，三盒」。
            </p>
          ) : null}
          {messages.map((message, index) => (
            <div
              key={index}
              className={`message ${message.role === 'user' ? 'message-user' : 'message-system'}`}
            >
              {message.text}
            </div>
          ))}
          {interim ? <div className="message message-interim">{interim}</div> : null}
        </div>

        <div className="voice-status" data-idle={phase === 'idle'}>
          {phaseLabel[phase]}
        </div>

        {voiceMode ? <div className="voice-meta">在线语音已连接 · 唤醒词已启用</div> : null}

        {error ? <div className="error-box">{error}</div> : null}

        {phase === 'idle' && messages.length === 0 ? (
          <button className="primary" style={{ width: '100%' }} onClick={() => void start()}>
            开始连续对话
          </button>
        ) : null}

        {awaiting ? (
          <div className="quick-actions">
            <button className="primary" onClick={() => quickReply('对')}>
              确认
            </button>
            <button onClick={() => quickReply('不对')}>取消这次</button>
          </div>
        ) : null}

        <div className="composer">
          <input
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitManual();
            }}
            placeholder={awaiting ? '也可以输入：不是，三盒' : '也可以输入：加两盒牛奶'}
          />
          <button className="primary" disabled={!manualText.trim()} onClick={submitManual}>
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
