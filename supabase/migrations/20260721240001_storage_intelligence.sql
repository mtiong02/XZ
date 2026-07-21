alter table inventory_transactions drop constraint inventory_transactions_transaction_type_check;
alter table inventory_transactions add constraint inventory_transactions_transaction_type_check
  check (transaction_type in ('ADD','CONSUME','DISCARD','CORRECT','MOVE','REVERSAL'));

with rules(food_name,zone_code,suitability,note,source) as (values
  ('牛奶','FRIDGE','RECOMMENDED','当前目录中的牛奶按鲜奶或需冷藏乳品处理，应按包装说明冷藏在4°C以下。','https://www.fda.gov/consumers/consumer-updates/are-you-storing-food-safely'),
  ('牛奶','FREEZER','ACCEPTABLE','可以冷冻延长保存，但解冻后质地可能变化；包装说明优先。','https://www.fda.gov/food/buy-store-serve-safe-food/food-and-water-safety-during-power-outages-and-floods'),
  ('牛奶','PANTRY','PROHIBITED','鲜奶或标注需冷藏的牛奶不可按常温食品保存；未开封常温奶应单独按包装类型记录。','https://www.fda.gov/consumers/consumer-updates/are-you-storing-food-safely'),
  ('猪肉','FRIDGE','RECOMMENDED','短期保存应冷藏在4°C以下，并与即食食物分开；长期保存可冷冻。','https://www.fda.gov/downloads/food/resourcesforyou/healtheducators/ucm109315.pdf'),
  ('猪肉','FREEZER','ACCEPTABLE','适合较长期冷冻保存，密封包装有助于保持品质。','https://www.fda.gov/downloads/food/resourcesforyou/healtheducators/ucm109315.pdf'),
  ('猪肉','PANTRY','PROHIBITED','生鲜猪肉属于易腐食品，不应在普通常温区保存。','https://www.fda.gov/consumers/consumer-updates/are-you-storing-food-safely'),
  ('牛肉','FRIDGE','RECOMMENDED','短期保存应冷藏在4°C以下，并与即食食物分开；长期保存可冷冻。','https://www.fda.gov/downloads/food/resourcesforyou/healtheducators/ucm109315.pdf'),
  ('牛肉','FREEZER','ACCEPTABLE','适合较长期冷冻保存，密封包装有助于保持品质。','https://www.fda.gov/downloads/food/resourcesforyou/healtheducators/ucm109315.pdf'),
  ('牛肉','PANTRY','PROHIBITED','生鲜牛肉属于易腐食品，不应在普通常温区保存。','https://www.fda.gov/consumers/consumer-updates/are-you-storing-food-safely'),
  ('鲈鱼','FRIDGE','RECOMMENDED','鲜鱼短期保存应冷藏在4°C以下，建议尽快食用；长期保存可冷冻。','https://www.fda.gov/downloads/food/resourcesforyou/healtheducators/ucm109315.pdf'),
  ('鲈鱼','FREEZER','ACCEPTABLE','适合较长期冷冻保存，密封包装有助于保持品质。','https://www.fda.gov/downloads/food/resourcesforyou/healtheducators/ucm109315.pdf'),
  ('鲈鱼','PANTRY','PROHIBITED','鲜鱼属于易腐食品，不应在普通常温区保存。','https://www.fda.gov/consumers/consumer-updates/are-you-storing-food-safely')
)
insert into food_storage_rules(food_id,storage_zone_code,suitability,condition_note,source_reference,reviewed_at)
select fc.id,r.zone_code,r.suitability,r.note,r.source,date '2026-07-21'
from rules r join food_catalog fc on fc.canonical_name=r.food_name and fc.household_id is null
on conflict(food_id,storage_zone_code) do update set suitability=excluded.suitability,
  condition_note=excluded.condition_note,source_reference=excluded.source_reference,
  reviewed_at=excluded.reviewed_at;
