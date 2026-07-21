-- Inventory 模块（docs/02 §7.3、docs/03 §9.1-9.2）
-- 拥有：refrigerators、storage_zones、inventory_lots、inventory_transactions
-- 关键不变量：remaining_quantity >= 0；交易与余额同事务；idempotency 唯一。

create table refrigerators (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  name text not null default '默认冰箱',
  created_at timestamptz not null default now()
);

create index refrigerators_household_idx on refrigerators (household_id);

create table storage_zones (
  id uuid primary key default gen_random_uuid(),
  refrigerator_id uuid not null references refrigerators (id) on delete cascade,
  household_id uuid not null references households (id) on delete cascade,
  code text not null check (code in ('FRIDGE', 'FREEZER', 'PANTRY')),
  name text not null,
  position integer not null default 0,
  unique (refrigerator_id, code)
);

create index storage_zones_household_idx on storage_zones (household_id);

create table inventory_lots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  refrigerator_id uuid not null references refrigerators (id),
  storage_zone_id uuid not null references storage_zones (id),
  food_id uuid not null references food_catalog (id),
  initial_quantity numeric not null check (initial_quantity > 0),
  remaining_quantity numeric not null check (remaining_quantity >= 0),
  unit_code text not null references units (code),
  purchased_at timestamptz not null default now(),
  expires_at timestamptz,
  expiry_source text not null default 'UNKNOWN'
    check (expiry_source in ('USER_CONFIRMED', 'PACKAGE_OCR', 'RULE_ESTIMATED', 'UNKNOWN')),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'DEPLETED', 'DISCARDED')),
  created_by_member_id uuid not null references household_members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index inventory_lots_household_idx on inventory_lots (household_id);
create index inventory_lots_food_idx on inventory_lots (household_id, food_id);
-- FEFO：按最早到期取批次
create index inventory_lots_fefo_idx
  on inventory_lots (household_id, food_id, expires_at asc nulls last)
  where status = 'ACTIVE';

-- 一条交易 = 一次业务命令的执行结果（docs/03 §9.2）
create table inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  transaction_type text not null
    check (transaction_type in ('ADD', 'CONSUME', 'DISCARD', 'CORRECT', 'REVERSAL')),
  -- 单食材命令时填写；多食材命令为 null，明细见 inventory_transaction_entries
  food_id uuid references food_catalog (id),
  source_channel text not null,
  actor_member_id uuid not null references household_members (id),
  interaction_id text,
  idempotency_key text not null,
  reversed_transaction_id uuid references inventory_transactions (id),
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- 同一 idempotency key 只执行一次（docs/01 业务规则 10）
create unique index inventory_transactions_idempotency_uq
  on inventory_transactions (household_id, idempotency_key);

create index inventory_transactions_household_created_idx
  on inventory_transactions (household_id, created_at desc);
create index inventory_transactions_food_idx
  on inventory_transactions (household_id, food_id);

-- 每条交易在各批次上的明细（一次 FEFO 消耗可跨多个批次）。
-- quantity_delta 为对 remaining_quantity 的带符号变化量。
create table inventory_transaction_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references inventory_transactions (id) on delete cascade,
  lot_id uuid not null references inventory_lots (id),
  quantity_delta numeric not null check (quantity_delta <> 0),
  unit_code text not null references units (code)
);

create index inventory_transaction_entries_txn_idx
  on inventory_transaction_entries (transaction_id);
create index inventory_transaction_entries_lot_idx
  on inventory_transaction_entries (lot_id);

-- 家庭级库存视图版本号，用于多端同步的 authoritative snapshot 对比
create table inventory_revisions (
  household_id uuid primary key references households (id) on delete cascade,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
