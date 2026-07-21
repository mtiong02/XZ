create table reminder_preferences (
  household_id uuid primary key references households(id) on delete cascade,
  daily_briefing_enabled boolean not null default true,
  daily_briefing_time time not null default '09:00',
  voice_enabled boolean not null default true,
  expiry_days integer not null default 3 check (expiry_days between 0 and 30),
  quiet_start time not null default '22:00',
  quiet_end time not null default '08:00',
  updated_at timestamptz not null default now()
);

create table reminder_tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  food_id uuid references food_catalog(id),
  reminder_text text not null check (char_length(reminder_text) between 1 and 300),
  scheduled_for timestamptz not null,
  status text not null default 'PENDING' check (status in ('PENDING','DELIVERED','CANCELLED','COMPLETED')),
  idempotency_key text not null,
  source_channel text not null default 'WEB_VOICE',
  created_by_member_id uuid not null references household_members(id),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique(household_id,idempotency_key)
);
create index reminder_tasks_due_idx on reminder_tasks(household_id,status,scheduled_for);

insert into reminder_preferences(household_id) select id from households on conflict do nothing;

alter table reminder_preferences enable row level security;
alter table reminder_tasks enable row level security;
create policy reminder_preferences_household_select on reminder_preferences for select to authenticated
  using (exists(select 1 from household_members hm where hm.household_id=reminder_preferences.household_id and hm.user_id=auth.uid()));
create policy reminder_tasks_household_select on reminder_tasks for select to authenticated
  using (exists(select 1 from household_members hm where hm.household_id=reminder_tasks.household_id and hm.user_id=auth.uid()));
