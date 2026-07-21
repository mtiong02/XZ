-- Transactional Outbox（docs/02 §12、ADR-011）
-- 与领域事务同库同事务写入；Worker 轮询消费。

create table outbox_events (
  id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid() unique,
  event_type text not null,
  schema_version text not null default '1.0',
  aggregate_type text not null,
  aggregate_id text not null,
  household_id uuid not null references households (id) on delete cascade,
  correlation_id text,
  payload_json jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  attempt_count integer not null default 0,
  last_error text,
  dead_lettered_at timestamptz
);

-- Worker 轮询未处理事件
create index outbox_events_pending_idx
  on outbox_events (available_at)
  where processed_at is null and dead_lettered_at is null;

create index outbox_events_household_idx on outbox_events (household_id);
