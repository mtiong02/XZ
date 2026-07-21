create table food_storage_rules (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references food_catalog(id) on delete cascade,
  storage_zone_code text not null check (storage_zone_code in ('FRIDGE','FREEZER','PANTRY')),
  suitability text not null check (suitability in ('RECOMMENDED','ACCEPTABLE','NOT_RECOMMENDED','PROHIBITED')),
  condition_note text not null,
  source_reference text not null,
  reviewed_at date not null,
  unique(food_id, storage_zone_code)
);

insert into food_storage_rules(food_id,storage_zone_code,suitability,condition_note,source_reference,reviewed_at)
select id, rule.zone_code, rule.suitability, rule.note, rule.source, date '2026-07-21'
from food_catalog
cross join (values
  ('PANTRY','RECOMMENDED','完整生土豆优先置于阴凉、避光、干燥且通风处。','https://www.fns.usda.gov/fs/produce-safety/storage'),
  ('FRIDGE','ACCEPTABLE','家庭冷藏并非普遍安全禁忌；若计划油炸，低温糖化可能影响成色和品质。','https://www.food.gov.uk/print/pdf/node/281'),
  ('FREEZER','PROHIBITED','完整生土豆不应直接冷冻；仅适用于经过专门预处理的冷冻产品。','https://www.fns.usda.gov/fs/produce-safety/storage')
) as rule(zone_code,suitability,note,source)
where canonical_name='土豆' and household_id is null
on conflict(food_id,storage_zone_code) do update set
  suitability=excluded.suitability,condition_note=excluded.condition_note,
  source_reference=excluded.source_reference,reviewed_at=excluded.reviewed_at;

alter table food_storage_rules enable row level security;
create policy food_storage_rules_authenticated_select on food_storage_rules
  for select to authenticated using (true);
