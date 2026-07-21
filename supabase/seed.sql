-- 开发/测试种子数据：基础单位与常见食材目录。
-- 生产环境的目录管理在后续 Sprint 引入运营流程。

insert into units (code, name_zh, name_en, kind, base_factor) values
  ('piece',  '个',  'piece',  'COUNT',  1),
  ('box',    '盒',  'box',    'COUNT',  1),
  ('bottle', '瓶',  'bottle', 'COUNT',  1),
  ('pack',   '包',  'pack',   'COUNT',  1),
  ('bag',    '袋',  'bag',    'COUNT',  1),
  ('bunch',  '把',  'bunch',  'COUNT',  1),
  ('jin',    '斤',  'catty',  'MASS',   500),
  ('g',      '克',  'gram',   'MASS',   1),
  ('kg',     '千克','kilogram','MASS',  1000),
  ('ml',     '毫升','milliliter','VOLUME', 1),
  ('l',      '升',  'liter',  'VOLUME', 1000)
on conflict (code) do nothing;

-- 新增食材的智能单位建议；已有全局食材也由迁移中的 update 补齐。

-- 全局食材目录（household_id 为 null）
with foods (canonical_name, category, category_code, default_unit_code, default_shelf_life_days, aliases) as (
  values
    ('鸡蛋',   'EGG_DAIRY', 'EGG',              'piece', 30, array['蛋','鸡卵','egg','eggs']),
    ('牛奶',   'EGG_DAIRY', 'LIQUID_DAIRY',     'box',    7, array['鲜奶','鲜牛奶','milk']),
    ('西红柿', 'VEGETABLE', 'FRUIT_VEGETABLE',  'piece',  7, array['番茄','tomato']),
    ('菠菜',   'VEGETABLE', 'LEAFY_VEGETABLE',  'g',      3, array['spinach']),
    ('青菜',   'VEGETABLE', 'LEAFY_VEGETABLE',  'g',      3, array['小白菜','上海青','bok choy']),
    ('胡萝卜', 'VEGETABLE', 'ROOT_TUBER',        'piece', 14, array['红萝卜','carrot']),
    ('土豆',   'VEGETABLE', 'ROOT_TUBER',        'piece', 21, array['马铃薯','potato']),
    ('洋葱',   'VEGETABLE', 'ALLIUM',            'piece', 21, array['onion']),
    ('苹果',   'FRUIT',     'POME_FRUIT',        'piece', 14, array['apple']),
    ('香蕉',   'FRUIT',     'TROPICAL_FRUIT',    'piece',  5, array['banana']),
    ('鸡胸肉', 'MEAT',      'POULTRY',           'g',      2, array['鸡胸','chicken breast']),
    ('猪肉',   'MEAT',      'PORK',              'g',      2, array['pork']),
    ('牛肉',   'MEAT',      'BEEF',              'g',      2, array['beef']),
    ('三文鱼', 'SEAFOOD',   'FISH',              'g',      2, array['salmon']),
    ('虾',     'SEAFOOD',   'SHRIMP',            'g',      2, array['虾仁','prawn','shrimp']),
    ('豆腐',   'SOY',       'SOY_PRODUCT',       'box',    5, array['tofu']),
    ('米',     'GRAIN',     'RICE_GRAIN',        'kg',   365, array['大米','rice']),
    ('面包',   'GRAIN',     'WHEAT_PRODUCT',     'pack',   4, array['吐司','bread','toast']),
    ('酸奶',   'EGG_DAIRY', 'FERMENTED_DAIRY',  'bottle', 14, array['优格','yogurt','yoghurt']),
    ('奶酪',   'EGG_DAIRY', 'CHEESE',            'pack',  30, array['芝士','起司','cheese'])
)
insert into food_catalog
  (canonical_name, category, category_code, default_unit_code, default_shelf_life_days)
select canonical_name, category, category_code, default_unit_code, default_shelf_life_days
from foods
on conflict do nothing;

update food_catalog
set preferred_unit_codes = case canonical_name
  when '鸡蛋' then array['piece']
  when '牛奶' then array['box', 'bottle', 'ml', 'l']
  when '西红柿' then array['piece', 'jin', 'g', 'kg']
  when '菠菜' then array['bunch', 'jin', 'g', 'kg']
  when '青菜' then array['bunch', 'jin', 'g', 'kg']
  when '胡萝卜' then array['piece', 'jin', 'g', 'kg']
  when '土豆' then array['piece', 'jin', 'g', 'kg']
  when '洋葱' then array['piece', 'jin', 'g', 'kg']
  when '苹果' then array['piece', 'jin', 'kg']
  when '香蕉' then array['piece', 'bunch', 'jin', 'kg']
  when '鸡胸肉' then array['jin', 'g', 'kg']
  when '猪肉' then array['jin', 'g', 'kg']
  when '牛肉' then array['jin', 'g', 'kg']
  when '三文鱼' then array['jin', 'g', 'kg']
  when '虾' then array['jin', 'g', 'kg']
  when '豆腐' then array['box', 'piece', 'g']
  when '米' then array['jin', 'kg', 'g', 'bag']
  when '面包' then array['pack', 'piece', 'bag']
  when '酸奶' then array['bottle', 'box', 'ml']
  when '奶酪' then array['pack', 'piece', 'g']
  else array[default_unit_code]
end
where household_id is null;

insert into food_aliases (food_id, alias, locale)
select fc.id, alias, case when alias ~ '^[a-zA-Z ]+$' then 'en' else 'zh' end
from food_catalog fc
join (
  values
    ('鸡蛋',   array['蛋','鸡卵','egg','eggs']),
    ('牛奶',   array['鲜奶','鲜牛奶','milk']),
    ('西红柿', array['番茄','tomato']),
    ('菠菜',   array['spinach']),
    ('青菜',   array['小白菜','上海青','bok choy']),
    ('胡萝卜', array['红萝卜','carrot']),
    ('土豆',   array['马铃薯','potato']),
    ('洋葱',   array['onion']),
    ('苹果',   array['apple']),
    ('香蕉',   array['banana']),
    ('鸡胸肉', array['鸡胸','chicken breast']),
    ('猪肉',   array['pork']),
    ('牛肉',   array['beef']),
    ('三文鱼', array['salmon']),
    ('虾',     array['虾仁','prawn','shrimp']),
    ('豆腐',   array['tofu']),
    ('米',     array['大米','rice']),
    ('面包',   array['吐司','bread','toast']),
    ('酸奶',   array['优格','yogurt','yoghurt']),
    ('奶酪',   array['芝士','起司','cheese'])
) as f (name, aliases) on fc.canonical_name = f.name and fc.household_id is null
cross join lateral unnest(f.aliases) as alias
on conflict (food_id, alias) do nothing;
-- 科学储存区域规则：来源与迁移 20260721230001 保持一致。
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

-- 易腐乳品、肉类和鲜鱼规则，与 20260721240001 保持一致；包装说明始终优先。
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

-- 基础菜谱候选，与 20260721233001 保持一致。
insert into recipes(name,description,instructions,tags,servings,source_reference) values
  ('清蒸鲈鱼','使用现有鲈鱼制作的少油家常菜',array['鲈鱼处理干净','蒸熟后按口味调味'],array['少油','高蛋白候选'],2,'XZ curated starter recipe; nutrition not calculated'),
  ('牛肉炖土豆','牛肉与土豆搭配的家常炖菜',array['牛肉切块焯水','加入土豆后炖至软熟'],array['家常','炖菜'],2,'XZ curated starter recipe; nutrition not calculated'),
  ('番茄炒鸡蛋','番茄和鸡蛋制作的快手家常菜',array['鸡蛋炒至凝固盛出','番茄炒软后与鸡蛋混合'],array['快手','家常'],2,'XZ curated starter recipe; nutrition not calculated')
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
