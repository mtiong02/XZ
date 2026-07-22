create table if not exists household_meal_profiles (
  household_id uuid primary key references households(id) on delete cascade,
  home_mode text not null default 'FULL_HOUSEHOLD'
    check (home_mode in ('FULL_HOUSEHOLD','PARTIAL_HOUSEHOLD','GUESTS','SOLO','UNKNOWN')),
  default_diners integer not null default 1 check (default_diners between 1 and 30),
  favorite_foods text[] not null default '{}',
  excluded_foods text[] not null default '{}',
  meal_styles text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table voice_jobs add column if not exists session_id uuid;
alter table voice_jobs add column if not exists turn_id uuid;
alter table voice_jobs add column if not exists cancel_requested_at timestamptz;
create index if not exists voice_jobs_session_idx on voice_jobs (session_id, created_at desc);

insert into household_meal_profiles(household_id, default_diners)
select h.id, greatest(1, (select count(*) from household_members hm where hm.household_id=h.id))
from households h
on conflict (household_id) do nothing;

alter table household_meal_profiles enable row level security;
drop policy if exists household_meal_profiles_select on household_meal_profiles;
create policy household_meal_profiles_select on household_meal_profiles
  for select to authenticated using (app.is_household_member(household_id));
drop policy if exists household_meal_profiles_write on household_meal_profiles;
create policy household_meal_profiles_write on household_meal_profiles
  for all to authenticated using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));
