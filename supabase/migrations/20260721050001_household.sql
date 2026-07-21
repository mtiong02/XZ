-- Household & Identity 模块（docs/02 §7.1）
-- 拥有：households、household_members

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  timezone text not null default 'Asia/Kuala_Lumpur',
  created_by_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  -- 允许无账号成员（如儿童/老人），有账号成员通过 user_id 关联登录身份
  user_id uuid references auth.users (id),
  display_name text not null check (char_length(display_name) between 1 and 50),
  role text not null default 'MEMBER' check (role in ('OWNER', 'MEMBER')),
  created_at timestamptz not null default now()
);

create unique index household_members_household_user_uq
  on household_members (household_id, user_id)
  where user_id is not null;

create index household_members_user_idx on household_members (user_id);
create index household_members_household_idx on household_members (household_id);
