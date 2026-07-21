create table member_wellness_profiles (
  member_id uuid primary key references household_members(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  birth_year integer check(birth_year is null or birth_year between 1900 and 2100),
  height_cm numeric(5,1) check(height_cm is null or height_cm between 50 and 250),
  goal text not null default 'GENERAL_WELLNESS' check(goal in ('GENERAL_WELLNESS','WEIGHT_MANAGEMENT','MUSCLE_SUPPORT','BALANCED_DIET')),
  allergen_codes text[] not null default '{}',
  dietary_restrictions text[] not null default '{}',
  health_considerations text[] not null default '{}',
  share_with_household boolean not null default false,
  consent_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(member_id,household_id)
);

create table member_body_measurements (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references household_members(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  metric_type text not null default 'WEIGHT' check(metric_type='WEIGHT'),
  value numeric(6,2) not null check(value between 20 and 400),
  unit_code text not null default 'kg' check(unit_code='kg'),
  measured_at timestamptz not null,
  source text not null default 'MANUAL' check(source='MANUAL'),
  note text check(note is null or length(note)<=200),
  created_at timestamptz not null default now()
);
create index member_measurements_member_time_idx on member_body_measurements(member_id,measured_at desc);

alter table member_wellness_profiles enable row level security;
alter table member_body_measurements enable row level security;

create policy wellness_profile_select on member_wellness_profiles for select to authenticated using(
  exists(select 1 from household_members own where own.id=member_id and own.user_id=auth.uid())
  or (share_with_household and exists(select 1 from household_members viewer where viewer.household_id=member_wellness_profiles.household_id and viewer.user_id=auth.uid()))
);
create policy wellness_profile_insert on member_wellness_profiles for insert to authenticated with check(
  exists(select 1 from household_members own where own.id=member_id and own.household_id=household_id and own.user_id=auth.uid())
);
create policy wellness_profile_update on member_wellness_profiles for update to authenticated using(
  exists(select 1 from household_members own where own.id=member_id and own.user_id=auth.uid())
) with check(
  exists(select 1 from household_members own where own.id=member_id and own.household_id=household_id and own.user_id=auth.uid())
);
create policy wellness_profile_delete on member_wellness_profiles for delete to authenticated using(
  exists(select 1 from household_members own where own.id=member_id and own.user_id=auth.uid())
);

create policy wellness_measurement_select on member_body_measurements for select to authenticated using(
  exists(select 1 from household_members own where own.id=member_id and own.user_id=auth.uid())
  or exists(select 1 from member_wellness_profiles p join household_members viewer on viewer.household_id=p.household_id
    where p.member_id=member_body_measurements.member_id and p.share_with_household and viewer.user_id=auth.uid())
);
create policy wellness_measurement_insert on member_body_measurements for insert to authenticated with check(
  exists(select 1 from household_members own where own.id=member_id and own.household_id=household_id and own.user_id=auth.uid())
);
create policy wellness_measurement_delete on member_body_measurements for delete to authenticated using(
  exists(select 1 from household_members own where own.id=member_id and own.user_id=auth.uid())
);
