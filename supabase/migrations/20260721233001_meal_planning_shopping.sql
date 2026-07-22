create table recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null,
  instructions text[] not null default '{}',
  tags text[] not null default '{}',
  servings integer not null default 2 check(servings > 0),
  source_reference text,
  review_status text not null default 'CURATED' check(review_status in ('CURATED','VERIFIED')),
  created_at timestamptz not null default now()
);

create table recipe_ingredients (
  recipe_id uuid not null references recipes(id) on delete cascade,
  food_id uuid not null references food_catalog(id),
  quantity numeric check(quantity > 0),
  unit_code text references units(code),
  optional boolean not null default false,
  primary key(recipe_id,food_id)
);

create table shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  food_id uuid not null references food_catalog(id),
  quantity numeric check(quantity is null or quantity > 0),
  unit_code text references units(code),
  status text not null default 'PENDING' check(status in ('PENDING','PURCHASED','CANCELLED')),
  source text not null default 'MANUAL' check(source in ('MANUAL','RECIPE','VOICE')),
  recipe_id uuid references recipes(id) on delete set null,
  idempotency_key text not null,
  created_by_member_id uuid not null references household_members(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(household_id,idempotency_key)
);
create index shopping_list_household_status_idx on shopping_list_items(household_id,status,created_at desc);



alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table shopping_list_items enable row level security;
create policy recipes_authenticated_select on recipes for select to authenticated using(true);
create policy recipe_ingredients_authenticated_select on recipe_ingredients for select to authenticated using(true);
create policy shopping_list_member_select on shopping_list_items for select to authenticated using(
  exists(select 1 from household_members hm where hm.household_id=shopping_list_items.household_id and hm.user_id=auth.uid())
);
