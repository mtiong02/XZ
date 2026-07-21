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

with recipe_seed(name,description,instructions,tags,servings) as (values
  ('清蒸鲈鱼','使用现有鲈鱼制作的少油家常菜',array['鲈鱼处理干净','蒸熟后按口味调味'],array['少油','高蛋白候选'],2),
  ('牛肉炖土豆','牛肉与土豆搭配的家常炖菜',array['牛肉切块焯水','加入土豆后炖至软熟'],array['家常','炖菜'],2),
  ('番茄炒鸡蛋','番茄和鸡蛋制作的快手家常菜',array['鸡蛋炒至凝固盛出','番茄炒软后与鸡蛋混合'],array['快手','家常'],2)
)
insert into recipes(name,description,instructions,tags,servings,source_reference)
select name,description,instructions,tags,servings,'XZ curated starter recipe; nutrition not calculated' from recipe_seed
on conflict(name) do nothing;

with ingredients(recipe_name,food_name,quantity,unit_code) as (values
  ('清蒸鲈鱼','鲈鱼',500::numeric,'g'),
  ('牛肉炖土豆','牛肉',500::numeric,'g'),
  ('牛肉炖土豆','土豆',2::numeric,'piece'),
  ('番茄炒鸡蛋','西红柿',2::numeric,'piece'),
  ('番茄炒鸡蛋','鸡蛋',3::numeric,'piece')
)
insert into recipe_ingredients(recipe_id,food_id,quantity,unit_code)
select r.id,fc.id,i.quantity,i.unit_code from ingredients i
join recipes r on r.name=i.recipe_name
join food_catalog fc on fc.canonical_name=i.food_name and fc.household_id is null
on conflict(recipe_id,food_id) do nothing;

alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table shopping_list_items enable row level security;
create policy recipes_authenticated_select on recipes for select to authenticated using(true);
create policy recipe_ingredients_authenticated_select on recipe_ingredients for select to authenticated using(true);
create policy shopping_list_member_select on shopping_list_items for select to authenticated using(
  exists(select 1 from household_members hm where hm.household_id=shopping_list_items.household_id and hm.user_id=auth.uid())
);
