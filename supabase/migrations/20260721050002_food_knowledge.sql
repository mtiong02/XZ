-- Food Knowledge 模块（docs/02 §7.2）
-- 拥有：units、food_catalog、food_aliases
-- MVP 只需要基础字段；营养值允许为空（nutrition_profiles 属未来契约，暂不建表）。

create table units (
  code text primary key,
  name_zh text not null,
  name_en text not null,
  kind text not null check (kind in ('COUNT', 'MASS', 'VOLUME')),
  -- 同 kind 内换算到基准单位（COUNT: piece，MASS: g，VOLUME: ml）的倍数
  base_factor numeric not null check (base_factor > 0)
);

create table food_catalog (
  id uuid primary key default gen_random_uuid(),
  -- null = 全局标准食材；非 null = 家庭自定义食材（P1 功能，先留字段）
  household_id uuid references households (id) on delete cascade,
  canonical_name text not null check (char_length(canonical_name) between 1 and 100),
  category text not null default 'OTHER',
  default_unit_code text not null references units (code),
  default_shelf_life_days integer check (default_shelf_life_days > 0),
  created_at timestamptz not null default now()
);

create index food_catalog_household_idx on food_catalog (household_id);
create unique index food_catalog_global_name_uq
  on food_catalog (canonical_name)
  where household_id is null;

create table food_aliases (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references food_catalog (id) on delete cascade,
  alias text not null check (char_length(alias) between 1 and 100),
  locale text not null default 'zh',
  unique (food_id, alias)
);

create index food_aliases_alias_idx on food_aliases (alias);
