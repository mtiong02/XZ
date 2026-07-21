-- Food Knowledge 专业食材分类树。
-- 使用邻接表保存层级；查询侧通过 recursive CTE 获取任意节点的全部后代。

create table food_categories (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,49}$'),
  parent_code text references food_categories (code),
  name_zh text not null unique check (char_length(name_zh) between 1 and 50),
  name_en text not null check (char_length(name_en) between 1 and 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (parent_code is null or parent_code <> code)
);

create index food_categories_parent_idx on food_categories (parent_code);

create table food_category_aliases (
  category_code text not null references food_categories (code) on delete cascade,
  alias text not null check (char_length(alias) between 1 and 50),
  locale text not null default 'zh',
  primary key (category_code, alias)
);

create index food_category_aliases_alias_idx on food_category_aliases (alias);

insert into food_categories (code, parent_code, name_zh, name_en, sort_order) values
  ('FOOD', null, '食材', 'Food', 10),
  ('ANIMAL_FOOD', 'FOOD', '动物性食材', 'Animal foods', 10),
  ('PLANT_FOOD', 'FOOD', '植物性食材', 'Plant foods', 20),
  ('FUNGI', 'FOOD', '菌菇类', 'Fungi and mushrooms', 30),
  ('SEASONING', 'FOOD', '调味料', 'Seasonings', 40),
  ('PROCESSED_FOOD', 'FOOD', '加工食品', 'Processed foods', 50),

  ('MEAT', 'ANIMAL_FOOD', '肉类', 'Meat', 10),
  ('AQUATIC', 'ANIMAL_FOOD', '水产海鲜', 'Aquatic foods and seafood', 20),
  ('EGG', 'ANIMAL_FOOD', '蛋类', 'Eggs', 30),
  ('DAIRY', 'ANIMAL_FOOD', '乳制品', 'Dairy', 40),
  ('LIVESTOCK_MEAT', 'MEAT', '畜肉', 'Livestock meat', 10),
  ('POULTRY', 'MEAT', '禽肉', 'Poultry', 20),
  ('PORK', 'LIVESTOCK_MEAT', '猪肉类', 'Pork', 10),
  ('BEEF', 'LIVESTOCK_MEAT', '牛肉类', 'Beef', 20),
  ('LAMB', 'LIVESTOCK_MEAT', '羊肉类', 'Lamb and mutton', 30),
  ('FISH', 'AQUATIC', '鱼类', 'Fish', 10),
  ('CRUSTACEAN', 'AQUATIC', '甲壳类', 'Crustaceans', 20),
  ('MOLLUSK', 'AQUATIC', '软体贝类', 'Mollusks and shellfish', 30),
  ('LOBSTER', 'CRUSTACEAN', '龙虾类', 'Lobsters', 10),
  ('SHRIMP', 'CRUSTACEAN', '虾类', 'Shrimp and prawns', 20),
  ('ABALONE', 'MOLLUSK', '鲍鱼类', 'Abalone', 10),
  ('LIQUID_DAIRY', 'DAIRY', '液态乳', 'Liquid dairy', 10),
  ('FERMENTED_DAIRY', 'DAIRY', '发酵乳', 'Fermented dairy', 20),
  ('CHEESE', 'DAIRY', '奶酪类', 'Cheese', 30),

  ('VEGETABLE', 'PLANT_FOOD', '蔬菜', 'Vegetables', 10),
  ('FRUIT', 'PLANT_FOOD', '水果', 'Fruit', 20),
  ('GRAIN_STAPLE', 'PLANT_FOOD', '谷物主食', 'Grains and staples', 30),
  ('LEGUME_SOY', 'PLANT_FOOD', '豆类及豆制品', 'Legumes and soy products', 40),
  ('LEAFY_VEGETABLE', 'VEGETABLE', '叶菜类', 'Leafy vegetables', 10),
  ('ROOT_TUBER', 'VEGETABLE', '根茎薯类', 'Roots, tubers and potatoes', 20),
  ('ALLIUM', 'VEGETABLE', '葱蒜类', 'Alliums', 30),
  ('FRUIT_VEGETABLE', 'VEGETABLE', '茄果类', 'Fruiting vegetables', 40),
  ('CRUCIFEROUS', 'VEGETABLE', '十字花科蔬菜', 'Cruciferous vegetables', 50),
  ('POME_FRUIT', 'FRUIT', '仁果类', 'Pome fruit', 10),
  ('CITRUS_FRUIT', 'FRUIT', '柑橘类', 'Citrus fruit', 20),
  ('BERRY_FRUIT', 'FRUIT', '浆果类', 'Berries', 30),
  ('TROPICAL_FRUIT', 'FRUIT', '热带水果', 'Tropical fruit', 40),
  ('STONE_FRUIT', 'FRUIT', '核果类', 'Stone fruit', 50),
  ('MELON_FRUIT', 'FRUIT', '瓜果类', 'Melons', 60),
  ('RICE_GRAIN', 'GRAIN_STAPLE', '稻米类', 'Rice grains', 10),
  ('WHEAT_PRODUCT', 'GRAIN_STAPLE', '小麦制品', 'Wheat products', 20),
  ('SOY_PRODUCT', 'LEGUME_SOY', '豆制品', 'Soy products', 10),
  ('LEGUME', 'LEGUME_SOY', '豆类', 'Legumes', 20),

  ('SPICE', 'SEASONING', '香辛料', 'Spices', 10),
  ('SAUCE', 'SEASONING', '酱汁酱料', 'Sauces', 20),
  ('OIL_FAT', 'SEASONING', '油脂', 'Oils and fats', 30),
  ('SALT_SUGAR', 'SEASONING', '盐糖基础调味', 'Salt and sugar seasonings', 40),
  ('AROMATIC', 'SEASONING', '香味蔬菜', 'Aromatic vegetables', 50);

insert into food_category_aliases (category_code, alias) values
  ('FOOD', '食材'), ('FOOD', '吃的'),
  ('ANIMAL_FOOD', '动物性食材'),
  ('PLANT_FOOD', '植物性食材'),
  ('MEAT', '肉'), ('MEAT', '肉类'), ('MEAT', '荤菜'),
  ('LIVESTOCK_MEAT', '畜肉'), ('POULTRY', '禽肉'),
  ('AQUATIC', '海鲜'), ('AQUATIC', '水产'), ('AQUATIC', '水产品'), ('AQUATIC', '鱼虾'),
  ('FISH', '鱼类'), ('CRUSTACEAN', '甲壳类'), ('CRUSTACEAN', '虾蟹'),
  ('MOLLUSK', '贝类'), ('MOLLUSK', '软体类'),
  ('LOBSTER', '龙虾'), ('LOBSTER', '龙虾类'), ('SHRIMP', '虾类'), ('ABALONE', '鲍鱼类'),
  ('EGG', '蛋类'), ('DAIRY', '奶制品'), ('DAIRY', '乳制品'), ('DAIRY', '奶类'),
  ('VEGETABLE', '蔬菜'), ('VEGETABLE', '青菜'), ('VEGETABLE', '菜类'), ('VEGETABLE', '素菜'),
  ('FRUIT', '水果'), ('FRUIT', '果类'),
  ('GRAIN_STAPLE', '主食'), ('GRAIN_STAPLE', '粮食'), ('GRAIN_STAPLE', '谷物'),
  ('LEGUME_SOY', '豆类和豆制品'), ('SOY_PRODUCT', '豆制品'),
  ('FUNGI', '菌菇'), ('FUNGI', '菌菇类'), ('FUNGI', '蘑菇类'),
  ('SEASONING', '调味料'), ('SEASONING', '调料'), ('SEASONING', '佐料'),
  ('SPICE', '香料'), ('SPICE', '香辛料'), ('SAUCE', '酱料'), ('SAUCE', '酱汁'),
  ('OIL_FAT', '食用油'), ('OIL_FAT', '油脂');

alter table food_catalog add column category_code text not null default 'FOOD'
  references food_categories (code);

update food_catalog set category_code = case canonical_name
  when '鸡蛋' then 'EGG'
  when '牛奶' then 'LIQUID_DAIRY'
  when '酸奶' then 'FERMENTED_DAIRY'
  when '奶酪' then 'CHEESE'
  when '西红柿' then 'FRUIT_VEGETABLE'
  when '菠菜' then 'LEAFY_VEGETABLE'
  when '青菜' then 'LEAFY_VEGETABLE'
  when '胡萝卜' then 'ROOT_TUBER'
  when '土豆' then 'ROOT_TUBER'
  when '洋葱' then 'ALLIUM'
  when '苹果' then 'POME_FRUIT'
  when '香蕉' then 'TROPICAL_FRUIT'
  when '鸡胸肉' then 'POULTRY'
  when '猪肉' then 'PORK'
  when '牛肉' then 'BEEF'
  when '三文鱼' then 'FISH'
  when '虾' then 'SHRIMP'
  when '豆腐' then 'SOY_PRODUCT'
  when '米' then 'RICE_GRAIN'
  when '面包' then 'WHEAT_PRODUCT'
  else case category
    when 'MEAT' then 'MEAT'
    when 'SEAFOOD' then 'AQUATIC'
    when 'EGG_DAIRY' then 'ANIMAL_FOOD'
    when 'VEGETABLE' then 'VEGETABLE'
    when 'FRUIT' then 'FRUIT'
    when 'SOY' then 'LEGUME_SOY'
    when 'GRAIN' then 'GRAIN_STAPLE'
    else 'FOOD'
  end
end;

create index food_catalog_category_code_idx on food_catalog (category_code);

insert into food_catalog
  (canonical_name, category, category_code, default_unit_code, preferred_unit_codes,
   default_shelf_life_days)
values
  ('澳洲龙虾', 'SEAFOOD', 'LOBSTER', 'g', array['piece', 'jin', 'g', 'kg'], 2),
  ('鲍鱼', 'SEAFOOD', 'ABALONE', 'piece', array['piece', 'jin', 'g', 'kg'], 2)
on conflict do nothing;

insert into food_aliases (food_id, alias, locale)
select fc.id, aliases.alias, 'zh'
from food_catalog fc
join (values
  ('澳洲龙虾', array['澳龙', '澳洲岩龙虾']),
  ('鲍鱼', array['鲜鲍', '鲍'])
) as source (name, aliases) on source.name = fc.canonical_name and fc.household_id is null
cross join lateral unnest(source.aliases) as aliases(alias)
on conflict (food_id, alias) do nothing;

comment on column food_catalog.category is
  'Legacy broad category retained for API compatibility; use category_code for taxonomy queries.';
comment on column food_catalog.category_code is
  'Leaf or nearest food_categories node; ancestor queries use a recursive CTE.';
