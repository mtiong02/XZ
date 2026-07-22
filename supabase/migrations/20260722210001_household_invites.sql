-- 家庭邀请码：让多个已注册账号安全加入同一个家庭。
create table if not exists household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  code_hash text not null unique,
  created_by_member_id uuid not null references household_members(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  max_uses integer not null default 5 check (max_uses between 1 and 30),
  used_count integer not null default 0 check (used_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists household_invites_household_idx on household_invites (household_id, created_at desc);
create index if not exists household_invites_active_idx on household_invites (code_hash, expires_at)
  where revoked_at is null;

alter table household_invites enable row level security;
drop policy if exists household_invites_select on household_invites;
create policy household_invites_select on household_invites
  for select to authenticated using (app.is_household_member(household_id));
drop policy if exists household_invites_write on household_invites;
create policy household_invites_write on household_invites
  for all to authenticated using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));
