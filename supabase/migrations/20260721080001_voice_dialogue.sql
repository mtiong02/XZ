-- 多轮语音对话（识别 -> 播报确认 -> 语音回应"对/不对/修正" -> 执行）。
-- 扩展 voice_jobs：新增追问状态、系统播报文案、回合计数、对话转录。

alter table voice_jobs
  drop constraint voice_jobs_status_check,
  add constraint voice_jobs_status_check
    check (status in (
      'PROCESSING', 'AWAITING_CONFIRMATION', 'AWAITING_CLARIFICATION',
      'COMPLETED', 'CANCELLED', 'FAILED'
    ));

alter table voice_jobs
  add column spoken_prompt text,
  add column turn_count integer not null default 0,
  -- 对话回合转录（user/system 交替），用于审计与前端展示；不含原始音频
  add column dialogue_turns jsonb not null default '[]';
