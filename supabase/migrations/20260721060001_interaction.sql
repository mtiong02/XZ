-- Interaction 模块（docs/02 §7.4）：语音任务与审计。
-- 原始音频不落库：临时文件处理后即删，优于 24 小时保留要求（docs/02 §10.1）。

create table voice_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  actor_member_id uuid not null references household_members (id),
  status text not null default 'PROCESSING'
    check (status in ('PROCESSING', 'AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED', 'FAILED')),
  locale text not null default 'zh',
  source_channel text not null default 'WEB_VOICE',
  input_mode text not null default 'AUDIO' check (input_mode in ('AUDIO', 'TEXT')),
  transcript_raw text,
  transcript_normalized text,
  candidate_command_json jsonb,
  confidence_json jsonb,
  requires_confirmation boolean not null default true,
  error_code text,
  audio_duration_ms integer,
  executed_transaction_id uuid references inventory_transactions (id),
  client_request_id text,
  retention_expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index voice_jobs_household_idx on voice_jobs (household_id, created_at desc);
-- 同一 client_request_id 不重复创建任务
create unique index voice_jobs_client_request_uq
  on voice_jobs (household_id, client_request_id)
  where client_request_id is not null;

alter table voice_jobs enable row level security;
create policy voice_jobs_member_select on voice_jobs
  for select to authenticated
  using (app.is_household_member(household_id));
