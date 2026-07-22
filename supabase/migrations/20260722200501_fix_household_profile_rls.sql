-- Repair the membership helper for deployments whose application tables live
-- in auth (the self-hosted compose stack) while remaining compatible with the
-- public schema used by Supabase projects.
create schema if not exists app;

create or replace function app.is_household_member(target_household_id uuid)
returns boolean
language sql
security definer
set search_path = auth, public
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

alter table household_meal_profiles enable row level security;
drop policy if exists household_meal_profiles_select on household_meal_profiles;
create policy household_meal_profiles_select on household_meal_profiles
  for select to authenticated
  using (app.is_household_member(household_id));
drop policy if exists household_meal_profiles_write on household_meal_profiles;
create policy household_meal_profiles_write on household_meal_profiles
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));
