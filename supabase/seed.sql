-- 开发/测试种子数据：基础单位与常见食材目录。
-- 生产环境的目录管理在后续 Sprint 引入运营流程。

insert into units (code, name_zh, name_en, kind, base_factor) values
  ('piece',  '个',  'piece',  'COUNT',  1),
  ('box',    '盒',  'box',    'COUNT',  1),
  ('bottle', '瓶',  'bottle', 'COUNT',  1),
  ('pack',   '包',  'pack',   'COUNT',  1),
  ('bag',    '袋',  'bag',    'COUNT',  1),
  ('bunch',  '把',  'bunch',  'COUNT',  1),
  ('g',      '克',  'gram',   'MASS',   1),
  ('kg',     '千克','kilogram','MASS',  1000),
  ('ml',     '毫升','milliliter','VOLUME', 1),
  ('l',      '升',  'liter',  'VOLUME', 1000)
on conflict (code) do nothing;

-- 全局食材目录（household_id 为 null）
with foods (canonical_name, category, default_unit_code, default_shelf_life_days, aliases) as (
  values
    ('鸡蛋',   'EGG_DAIRY', 'piece', 30, array['蛋','鸡卵','egg','eggs']),
    ('牛奶',   'EGG_DAIRY', 'box',    7, array['鲜奶','鲜牛奶','milk']),
    ('西红柿', 'VEGETABLE', 'piece',  7, array['番茄','tomato']),
    ('菠菜',   'VEGETABLE', 'g',      3, array['spinach']),
    ('青菜',   'VEGETABLE', 'g',      3, array['小白菜','上海青','bok choy']),
    ('胡萝卜', 'VEGETABLE', 'piece', 14, array['红萝卜','carrot']),
    ('土豆',   'VEGETABLE', 'piece', 21, array['马铃薯','potato']),
    ('洋葱',   'VEGETABLE', 'piece', 21, array['onion']),
    ('苹果',   'FRUIT',     'piece', 14, array['apple']),
    ('香蕉',   'FRUIT',     'piece',  5, array['banana']),
    ('鸡胸肉', 'MEAT',      'g',      2, array['鸡胸','chicken breast']),
    ('猪肉',   'MEAT',      'g',      2, array['pork']),
    ('牛肉',   'MEAT',      'g',      2, array['beef']),
    ('三文鱼', 'SEAFOOD',   'g',      2, array['salmon']),
    ('虾',     'SEAFOOD',   'g',      2, array['虾仁','prawn','shrimp']),
    ('豆腐',   'SOY',       'box',    5, array['tofu']),
    ('米',     'GRAIN',     'kg',   365, array['大米','rice']),
    ('面包',   'GRAIN',     'pack',   4, array['吐司','bread','toast']),
    ('酸奶',   'EGG_DAIRY', 'bottle', 14, array['优格','yogurt','yoghurt']),
    ('奶酪',   'EGG_DAIRY', 'pack',  30, array['芝士','起司','cheese'])
)
insert into food_catalog (canonical_name, category, default_unit_code, default_shelf_life_days)
select canonical_name, category, default_unit_code, default_shelf_life_days
from foods
on conflict do nothing;

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
