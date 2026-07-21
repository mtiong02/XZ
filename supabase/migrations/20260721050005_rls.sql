-- 多租户隔离第二道防线（docs/02 §15.1）：
-- 第一道防线是 API 应用层 membership 校验；API/Worker 使用 service_role 连接（绕过 RLS）。
-- RLS 保护的是客户端直连路径（supabase-js 读取、Realtime）。
-- 客户端只读；所有写操作必须经 API 命令通道，因此不创建任何 insert/update/delete 策略。

-- 辅助函数：当前登录用户是否为某家庭成员
create schema if not exists app;

create or replace function app.is_household_member(target_household_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
  );
$$;

revoke all on function app.is_household_member(uuid) from public;
grant execute on function app.is_household_member(uuid) to authenticated;
grant usage on schema app to authenticated;

-- households
alter table households enable row level security;
create policy households_member_select on households
  for select to authenticated
  using (app.is_household_member(id));

-- household_members
alter table household_members enable row level security;
create policy household_members_member_select on household_members
  for select to authenticated
  using (app.is_household_member(household_id));

-- units：公共资料，认证用户可读
alter table units enable row level security;
create policy units_authenticated_select on units
  for select to authenticated
  using (true);

-- food_catalog：全局条目对认证用户可读；家庭自定义条目仅家庭成员可读
alter table food_catalog enable row level security;
create policy food_catalog_select on food_catalog
  for select to authenticated
  using (household_id is null or app.is_household_member(household_id));

-- food_aliases：跟随所属食材可见性
alter table food_aliases enable row level security;
create policy food_aliases_select on food_aliases
  for select to authenticated
  using (
    exists (
      select 1 from food_catalog fc
      where fc.id = food_aliases.food_id
        and (fc.household_id is null or app.is_household_member(fc.household_id))
    )
  );

-- 库存相关表：仅家庭成员可读
alter table refrigerators enable row level security;
create policy refrigerators_member_select on refrigerators
  for select to authenticated
  using (app.is_household_member(household_id));

alter table storage_zones enable row level security;
create policy storage_zones_member_select on storage_zones
  for select to authenticated
  using (app.is_household_member(household_id));

alter table inventory_lots enable row level security;
create policy inventory_lots_member_select on inventory_lots
  for select to authenticated
  using (app.is_household_member(household_id));

alter table inventory_transactions enable row level security;
create policy inventory_transactions_member_select on inventory_transactions
  for select to authenticated
  using (app.is_household_member(household_id));

alter table inventory_transaction_entries enable row level security;
create policy inventory_transaction_entries_member_select on inventory_transaction_entries
  for select to authenticated
  using (
    exists (
      select 1 from inventory_transactions t
      where t.id = inventory_transaction_entries.transaction_id
        and app.is_household_member(t.household_id)
    )
  );

alter table inventory_revisions enable row level security;
create policy inventory_revisions_member_select on inventory_revisions
  for select to authenticated
  using (app.is_household_member(household_id));

-- outbox 是内部基础设施，客户端不可见
alter table outbox_events enable row level security;
