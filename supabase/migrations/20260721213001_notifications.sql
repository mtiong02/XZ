-- Realtime & Notification 模块。只保存投递/处理事实，不拥有库存事实。
create table notification_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  rule_type text not null check (rule_type in ('EXPIRY', 'DAILY_SUMMARY', 'RESTOCK')),
  enabled boolean not null default true,
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, rule_type)
);

create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  notification_type text not null check (notification_type in ('EXPIRING', 'EXPIRED', 'DAILY_SUMMARY', 'RESTOCK')),
  inventory_ref uuid,
  dedupe_key text not null,
  title text not null,
  body text not null,
  severity text not null check (severity in ('INFO', 'WARNING', 'CRITICAL')),
  status text not null default 'UNREAD' check (status in ('UNREAD', 'READ', 'SNOOZED', 'ACTIONED')),
  metadata jsonb not null default '{}',
  available_at timestamptz not null default now(),
  read_at timestamptz,
  snoozed_until timestamptz,
  actioned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (household_id, dedupe_key)
);

create index notification_deliveries_household_status_idx
  on notification_deliveries(household_id, status, available_at desc);

alter table notification_rules enable row level security;
alter table notification_deliveries enable row level security;
create policy notification_rules_household_select on notification_rules for select to authenticated
  using (exists(select 1 from household_members hm where hm.household_id = notification_rules.household_id and hm.user_id = auth.uid()));
create policy notification_deliveries_household_select on notification_deliveries for select to authenticated
  using (exists(select 1 from household_members hm where hm.household_id = notification_deliveries.household_id and hm.user_id = auth.uid()));

insert into notification_rules(household_id, rule_type, config)
select id, 'EXPIRY', '{"within_days":3}'::jsonb from households on conflict do nothing;
insert into notification_rules(household_id, rule_type, config)
select id, 'DAILY_SUMMARY', '{"local_hour":9}'::jsonb from households on conflict do nothing;
