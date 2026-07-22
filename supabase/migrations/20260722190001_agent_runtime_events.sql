create table if not exists agent_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  actor_member_id uuid references household_members(id) on delete set null,
  session_id uuid,
  turn_id uuid,
  task_id uuid,
  event_type text not null,
  intent text,
  outcome text,
  latency_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_events_household_created
  on agent_events (household_id, created_at desc);
create index if not exists idx_agent_events_type_created
  on agent_events (event_type, created_at desc);
