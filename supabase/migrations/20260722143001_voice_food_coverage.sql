-- 将真实语音对话中高频、但目录未覆盖的食材纳入全局知识库。
-- 保持“食材名/别名/计量单位/保存规则”分离：解析使用 aliases，库存写入仍使用 canonical food id。

insert into food_categories (code, parent_code, name_zh, name_en, sort_order) values
  ('WINE_BEVERAGE', 'BEVERAGE', '葡萄酒', 'Wine', 30),
  ('PROCESSED_MEAT', 'PROCESSED_FOOD', '肉制品', 'Processed meat products', 30)
on conflict (code) do nothing;

with foods(name, legacy_category, category_code, unit_code, units, shelf_days, allergens) as (
  values
    ('皮蛋', 'EGG_DAIRY', 'EGG', 'piece', array['piece','box'], 30, array['EGG']),
    ('香肠', 'MEAT', 'PROCESSED_MEAT', 'piece', array['piece','jin','g','kg','pack'], 14, array[]::text[]),
    ('巴沙鱼', 'SEAFOOD', 'FISH', 'g', array['piece','jin','g','kg'], 2, array['FISH']),
    ('红酒', 'OTHER', 'WINE_BEVERAGE', 'bottle', array['bottle','ml','l'], 730, array[]::text[])
)
insert into food_catalog
  (canonical_name, category, category_code, default_unit_code, preferred_unit_codes,
   default_shelf_life_days, data_source, source_reference, allergen_codes, review_status)
select name, legacy_category, category_code, unit_code, units, shelf_days,
       'XZ_CURATED', 'XZ voice dialogue coverage 2026-07-22', allergens, 'CURATED'
from foods
on conflict do nothing;

-- “鸡胸肉”是片/块和重量两种都常见的记录方式；补齐 ASR 常见近音别名。
update food_catalog
set preferred_unit_codes = array['piece','jin','g','kg']
where household_id is null and canonical_name = '鸡胸肉';

insert into food_aliases(food_id, alias, locale)
select fc.id, source.alias, 'zh'
from food_catalog fc
join (values
  ('鸡胸肉', '鸡胸'), ('鸡胸肉', '鸡胸肉片'), ('鸡胸肉', '机胸肉'),
  ('牛肉', '牛腩'),
  ('皮蛋', '松花蛋'), ('皮蛋', '变蛋'), ('皮蛋', '皮蛋儿'),
  ('香肠', '腊肠'), ('香肠', '火腿肠'), ('香肠', '香肠儿'),
  ('巴沙鱼', '巴沙'), ('巴沙鱼', '巴沙鱼片'), ('巴沙鱼', '巴鲨鱼'),
  ('红酒', '葡萄酒'), ('红酒', '红葡萄酒')
) as source(name, alias) on source.name = fc.canonical_name and fc.household_id is null
on conflict (food_id, alias) do nothing;

-- 新增条目的保存建议。包装标签和实际到期日始终优先；这里不把“可冷冻”误写为默认存放位置。
with rules(food_name, zone_code, suitability, note, source) as (values
  ('鸡胸肉', 'FRIDGE', 'RECOMMENDED', '短期保存应冷藏在4°C以下；长期保存可冷冻。包装日期优先。', 'https://www.fda.gov/downloads/food/resourcesforyou/healtheducators/ucm109315.pdf'),
  ('鸡胸肉', 'FREEZER', 'ACCEPTABLE', '适合较长期冷冻保存，建议密封分装并记录日期。', 'https://www.fda.gov/downloads/food/resourcesforyou/healtheducators/ucm109315.pdf'),
  ('巴沙鱼', 'FRIDGE', 'RECOMMENDED', '鲜鱼短期保存应冷藏在4°C以下，建议尽快食用；长期保存可冷冻。', 'https://www.fda.gov/downloads/food/resourcesforyou/healtheducators/ucm109315.pdf'),
  ('巴沙鱼', 'FREEZER', 'ACCEPTABLE', '适合较长期冷冻保存，密封包装有助于保持品质。', 'https://www.fda.gov/downloads/food/resourcesforyou/healtheducators/ucm109315.pdf'),
  ('香肠', 'FRIDGE', 'RECOMMENDED', '冷藏香肠按包装标示保存；开封后应尽快食用。', 'https://www.fda.gov/consumers/consumer-updates/are-you-storing-food-safely'),
  ('香肠', 'FREEZER', 'ACCEPTABLE', '需要长期保存时可冷冻，具体以包装说明为准。', 'https://www.fda.gov/consumers/consumer-updates/are-you-storing-food-safely'),
  ('皮蛋', 'PANTRY', 'ACCEPTABLE', '未开封产品是否可常温保存以包装标签为准；开封后应冷藏并尽快食用。', 'XZ curated operational rule; package label overrides'),
  ('皮蛋', 'FRIDGE', 'RECOMMENDED', '已开封皮蛋应冷藏并尽快食用；包装标签优先。', 'XZ curated operational rule; package label overrides'),
  ('红酒', 'PANTRY', 'RECOMMENDED', '未开封红酒宜避光、恒温保存；开封后建议按产品说明冷藏并尽快饮用。', 'XZ curated operational rule; package label overrides'),
  ('红酒', 'FRIDGE', 'ACCEPTABLE', '开封后可冷藏以延缓品质变化；以产品标签为准。', 'XZ curated operational rule; package label overrides')
)
insert into food_storage_rules(food_id, storage_zone_code, suitability, condition_note, source_reference, reviewed_at)
select fc.id, r.zone_code, r.suitability, r.note, r.source, date '2026-07-22'
from rules r join food_catalog fc on fc.canonical_name = r.food_name and fc.household_id is null
on conflict(food_id, storage_zone_code) do update set
  suitability = excluded.suitability,
  condition_note = excluded.condition_note,
  source_reference = excluded.source_reference,
  reviewed_at = excluded.reviewed_at;

-- “土豆牛腩”是用户常用叫法；使用已有“牛肉”库存项，避免为同一原料建立重复库存实体。
insert into recipes(name, description, instructions, tags, servings, source_reference)
values (
  '土豆炖牛腩',
  '牛肉与土豆的家常炖菜，可按现有库存核对缺料。',
  array['牛肉焯水后加调味料炖煮','加入土豆和洋葱炖至软熟'],
  array['家常','炖菜'],
  2,
  'XZ curated starter recipe; nutrition not calculated'
)
on conflict(name) do nothing;

with ingredients(recipe_name, food_name, quantity, unit_code) as (values
  ('土豆炖牛腩', '牛肉', 500::numeric, 'g'),
  ('土豆炖牛腩', '土豆', 2::numeric, 'piece'),
  ('土豆炖牛腩', '洋葱', 1::numeric, 'piece')
)
insert into recipe_ingredients(recipe_id, food_id, quantity, unit_code)
select r.id, fc.id, i.quantity, i.unit_code
from ingredients i
join recipes r on r.name = i.recipe_name
join food_catalog fc on fc.canonical_name = i.food_name and fc.household_id is null
on conflict(recipe_id, food_id) do update set quantity = excluded.quantity, unit_code = excluded.unit_code;
