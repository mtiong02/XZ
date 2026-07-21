-- Food Knowledge 专业化基础：扩展分类、主数据来源、过敏原、保质规则与营养引用。
-- 营养值不在无权威来源时臆造；nutrition_profiles 仅保存可追溯引用和已核验数据。

alter table food_catalog
  add column if not exists scientific_name text,
  add column if not exists data_source text not null default 'XZ_CURATED',
  add column if not exists source_reference text,
  add column if not exists allergen_codes text[] not null default '{}',
  add column if not exists review_status text not null default 'CURATED'
    check (review_status in ('CURATED', 'VERIFIED', 'HOUSEHOLD'));

create table shelf_life_rules (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references food_catalog(id) on delete cascade,
  storage_zone_code text not null check (storage_zone_code in ('FRIDGE', 'FREEZER', 'PANTRY')),
  min_days integer check (min_days > 0),
  max_days integer not null check (max_days > 0),
  condition_note text,
  source_reference text,
  unique (food_id, storage_zone_code),
  check (min_days is null or min_days <= max_days)
);

create table nutrition_profiles (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references food_catalog(id) on delete cascade,
  source_name text not null,
  source_food_code text,
  basis_quantity numeric not null default 100 check (basis_quantity > 0),
  basis_unit_code text not null references units(code),
  energy_kcal numeric check (energy_kcal >= 0),
  protein_g numeric check (protein_g >= 0),
  fat_g numeric check (fat_g >= 0),
  carbohydrate_g numeric check (carbohydrate_g >= 0),
  fiber_g numeric check (fiber_g >= 0),
  sodium_mg numeric check (sodium_mg >= 0),
  verified_at timestamptz,
  unique (food_id, source_name)
);

insert into food_categories (code, parent_code, name_zh, name_en, sort_order) values
  ('OTHER_POULTRY', 'MEAT', '其他禽肉', 'Other poultry', 30),
  ('GAME_MEAT', 'MEAT', '野味及其他肉类', 'Game and other meat', 40),
  ('CRAB', 'CRUSTACEAN', '蟹类', 'Crabs', 30),
  ('CEPHALOPOD', 'MOLLUSK', '头足类', 'Cephalopods', 20),
  ('BIVALVE', 'MOLLUSK', '双壳贝类', 'Bivalves', 30),
  ('SEA_VEGETABLE', 'PLANT_FOOD', '藻类', 'Sea vegetables', 45),
  ('STEM_VEGETABLE', 'VEGETABLE', '茎菜类', 'Stem vegetables', 60),
  ('FLOWER_VEGETABLE', 'VEGETABLE', '花菜类', 'Flower vegetables', 70),
  ('GOURD_VEGETABLE', 'VEGETABLE', '瓜类蔬菜', 'Gourd vegetables', 80),
  ('POD_VEGETABLE', 'VEGETABLE', '豆荚类蔬菜', 'Pod vegetables', 90),
  ('BANANA_FRUIT', 'TROPICAL_FRUIT', '蕉类', 'Bananas', 10),
  ('TROPICAL_OTHER', 'TROPICAL_FRUIT', '其他热带水果', 'Other tropical fruit', 20),
  ('GRAPE_FRUIT', 'FRUIT', '葡萄类', 'Grapes', 70),
  ('DRIED_FRUIT', 'FRUIT', '干果类', 'Dried fruit', 80),
  ('CORN_GRAIN', 'GRAIN_STAPLE', '玉米类', 'Corn and maize', 30),
  ('COARSE_GRAIN', 'GRAIN_STAPLE', '杂粮类', 'Coarse grains', 40),
  ('TUBER_STAPLE', 'GRAIN_STAPLE', '薯类主食', 'Tuber staples', 50),
  ('NUT_SEED', 'PLANT_FOOD', '坚果与种子', 'Nuts and seeds', 50),
  ('TREE_NUT', 'NUT_SEED', '树坚果', 'Tree nuts', 10),
  ('PEANUT', 'NUT_SEED', '花生类', 'Peanuts', 20),
  ('SEED', 'NUT_SEED', '种子类', 'Seeds', 30),
  ('FRESH_MUSHROOM', 'FUNGI', '鲜菌菇', 'Fresh mushrooms', 10),
  ('DRIED_MUSHROOM', 'FUNGI', '干制菌菇', 'Dried mushrooms', 20),
  ('VINEGAR', 'SEASONING', '食醋', 'Vinegars', 60),
  ('COOKING_WINE', 'SEASONING', '烹饪酒', 'Cooking wine', 70),
  ('BEVERAGE', 'FOOD', '饮品', 'Beverages', 60),
  ('TEA_BEVERAGE', 'BEVERAGE', '茶饮', 'Tea beverages', 10),
  ('JUICE_BEVERAGE', 'BEVERAGE', '果蔬汁', 'Fruit and vegetable juices', 20),
  ('READY_MEAL', 'PROCESSED_FOOD', '预制及即食食品', 'Ready meals', 10),
  ('NOODLE_PRODUCT', 'PROCESSED_FOOD', '面点制品', 'Noodle products', 20)
on conflict (code) do nothing;

insert into food_category_aliases (category_code, alias) values
  ('CRAB','螃蟹'), ('CEPHALOPOD','鱿鱼章鱼'), ('BIVALVE','贝壳类'),
  ('SEA_VEGETABLE','海藻'), ('SEA_VEGETABLE','藻类'), ('STEM_VEGETABLE','茎菜'),
  ('FLOWER_VEGETABLE','花菜'), ('GOURD_VEGETABLE','瓜类蔬菜'), ('POD_VEGETABLE','豆角类'),
  ('NUT_SEED','坚果'), ('NUT_SEED','种子'), ('FRESH_MUSHROOM','鲜蘑菇'),
  ('DRIED_MUSHROOM','干菌菇'), ('BEVERAGE','饮料'), ('BEVERAGE','饮品')
on conflict (category_code, alias) do nothing;

update food_catalog set category_code = 'BANANA_FRUIT'
where household_id is null and canonical_name = '香蕉';

with foods(name, legacy_category, category_code, unit_code, units, shelf_days, aliases, allergens) as (
  values
  ('羊肉','MEAT','LAMB','g',array['jin','g','kg'],3,array['羊肉片','mutton'],array[]::text[]),
  ('鸡肉','MEAT','POULTRY','g',array['jin','g','kg','piece'],3,array['鸡','整鸡','chicken'],array[]::text[]),
  ('鸭肉','MEAT','OTHER_POULTRY','g',array['jin','g','kg','piece'],3,array['鸭','整鸭','duck'],array[]::text[]),
  ('带鱼','SEAFOOD','FISH','g',array['jin','g','kg'],2,array['刀鱼'],array['FISH']),
  ('鲈鱼','SEAFOOD','FISH','g',array['piece','jin','g','kg'],2,array['花鲈'],array['FISH']),
  ('鳕鱼','SEAFOOD','FISH','g',array['jin','g','kg'],2,array['cod'],array['FISH']),
  ('螃蟹','SEAFOOD','CRAB','piece',array['piece','jin','g','kg'],2,array['蟹','大闸蟹'],array['CRUSTACEAN']),
  ('黑虎虾','SEAFOOD','SHRIMP','g',array['piece','jin','g','kg'],2,array['虎虾','斑节虾'],array['CRUSTACEAN']),
  ('鱿鱼','SEAFOOD','CEPHALOPOD','g',array['piece','jin','g','kg'],2,array['鲜鱿'],array['MOLLUSK']),
  ('章鱼','SEAFOOD','CEPHALOPOD','g',array['piece','jin','g','kg'],2,array['八爪鱼'],array['MOLLUSK']),
  ('扇贝','SEAFOOD','BIVALVE','piece',array['piece','jin','g','kg'],2,array['鲜贝'],array['MOLLUSK']),
  ('生蚝','SEAFOOD','BIVALVE','piece',array['piece','jin','g','kg'],2,array['牡蛎','蚝'],array['MOLLUSK']),
  ('鸭蛋','EGG_DAIRY','EGG','piece',array['piece','box'],30,array['duck egg'],array['EGG']),
  ('黄油','EGG_DAIRY','OIL_FAT','g',array['g','pack'],30,array['牛油','butter'],array['MILK']),
  ('生菜','VEGETABLE','LEAFY_VEGETABLE','g',array['bunch','jin','g','kg'],4,array['叶用莴苣'],array[]::text[]),
  ('白菜','VEGETABLE','LEAFY_VEGETABLE','g',array['piece','jin','g','kg'],7,array['大白菜'],array[]::text[]),
  ('芹菜','VEGETABLE','STEM_VEGETABLE','g',array['bunch','jin','g','kg'],7,array['西芹'],array[]::text[]),
  ('莲藕','VEGETABLE','STEM_VEGETABLE','g',array['piece','jin','g','kg'],7,array['藕'],array[]::text[]),
  ('西兰花','VEGETABLE','FLOWER_VEGETABLE','g',array['piece','jin','g','kg'],5,array['绿花椰菜'],array[]::text[]),
  ('菜花','VEGETABLE','FLOWER_VEGETABLE','g',array['piece','jin','g','kg'],5,array['花椰菜','白花菜'],array[]::text[]),
  ('黄瓜','VEGETABLE','GOURD_VEGETABLE','piece',array['piece','jin','g','kg'],7,array['青瓜'],array[]::text[]),
  ('南瓜','VEGETABLE','GOURD_VEGETABLE','g',array['piece','jin','g','kg'],14,array['倭瓜'],array[]::text[]),
  ('冬瓜','VEGETABLE','GOURD_VEGETABLE','g',array['piece','jin','g','kg'],14,array[]::text[],array[]::text[]),
  ('茄子','VEGETABLE','FRUIT_VEGETABLE','piece',array['piece','jin','g','kg'],7,array[]::text[],array[]::text[]),
  ('青椒','VEGETABLE','FRUIT_VEGETABLE','piece',array['piece','jin','g','kg'],7,array['甜椒','柿子椒'],array[]::text[]),
  ('豆角','VEGETABLE','POD_VEGETABLE','g',array['bunch','jin','g','kg'],5,array['四季豆'],array[]::text[]),
  ('蒜','VEGETABLE','ALLIUM','piece',array['piece','jin','g'],30,array['大蒜','蒜头'],array[]::text[]),
  ('姜','VEGETABLE','AROMATIC','g',array['piece','jin','g'],30,array['生姜'],array[]::text[]),
  ('海带','VEGETABLE','SEA_VEGETABLE','g',array['piece','jin','g','kg'],7,array['昆布'],array[]::text[]),
  ('紫菜','VEGETABLE','SEA_VEGETABLE','pack',array['pack','g'],180,array['海苔'],array[]::text[]),
  ('橙子','FRUIT','CITRUS_FRUIT','piece',array['piece','jin','kg'],14,array['甜橙'],array[]::text[]),
  ('柠檬','FRUIT','CITRUS_FRUIT','piece',array['piece','jin','kg'],21,array[]::text[],array[]::text[]),
  ('草莓','FRUIT','BERRY_FRUIT','g',array['box','jin','g','kg'],3,array[]::text[],array[]::text[]),
  ('蓝莓','FRUIT','BERRY_FRUIT','g',array['box','g'],7,array[]::text[],array[]::text[]),
  ('葡萄','FRUIT','GRAPE_FRUIT','g',array['bunch','jin','g','kg'],7,array[]::text[],array[]::text[]),
  ('芒果','FRUIT','TROPICAL_OTHER','piece',array['piece','jin','kg'],7,array[]::text[],array[]::text[]),
  ('菠萝','FRUIT','TROPICAL_OTHER','piece',array['piece','jin','kg'],7,array['凤梨'],array[]::text[]),
  ('西瓜','FRUIT','MELON_FRUIT','piece',array['piece','jin','kg'],7,array[]::text[],array[]::text[]),
  ('桃','FRUIT','STONE_FRUIT','piece',array['piece','jin','kg'],7,array['桃子'],array[]::text[]),
  ('玉米','GRAIN','CORN_GRAIN','piece',array['piece','jin','g','kg'],7,array['玉米棒','苞米'],array[]::text[]),
  ('燕麦','GRAIN','COARSE_GRAIN','g',array['g','kg','bag'],180,array['燕麦片'],array['GLUTEN']),
  ('小米','GRAIN','COARSE_GRAIN','g',array['jin','g','kg','bag'],365,array[]::text[],array[]::text[]),
  ('红薯','GRAIN','TUBER_STAPLE','piece',array['piece','jin','g','kg'],21,array['地瓜','番薯'],array[]::text[]),
  ('黄豆','SOY','LEGUME','g',array['jin','g','kg','bag'],365,array['大豆'],array['SOY']),
  ('绿豆','SOY','LEGUME','g',array['jin','g','kg','bag'],365,array[]::text[],array[]::text[]),
  ('腐竹','SOY','SOY_PRODUCT','g',array['pack','g'],180,array['豆腐皮'],array['SOY']),
  ('香菇','OTHER','FRESH_MUSHROOM','g',array['pack','jin','g','kg'],5,array['冬菇'],array[]::text[]),
  ('金针菇','OTHER','FRESH_MUSHROOM','pack',array['pack','jin','g'],5,array[]::text[],array[]::text[]),
  ('木耳','OTHER','DRIED_MUSHROOM','g',array['pack','g'],180,array['黑木耳'],array[]::text[]),
  ('花生','OTHER','PEANUT','g',array['pack','jin','g'],180,array['花生米'],array['PEANUT']),
  ('核桃','OTHER','TREE_NUT','g',array['piece','pack','g'],180,array['核桃仁'],array['TREE_NUT']),
  ('芝麻','OTHER','SEED','g',array['pack','g'],180,array[]::text[],array['SESAME']),
  ('食盐','SEASONING','SALT_SUGAR','g',array['pack','g'],730,array['盐'],array[]::text[]),
  ('白糖','SEASONING','SALT_SUGAR','g',array['pack','g'],730,array['砂糖','白砂糖'],array[]::text[]),
  ('生抽','SEASONING','SAUCE','ml',array['bottle','ml','l'],365,array['酱油'],array['SOY','GLUTEN']),
  ('陈醋','SEASONING','VINEGAR','ml',array['bottle','ml','l'],365,array['醋','食醋'],array[]::text[]),
  ('料酒','SEASONING','COOKING_WINE','ml',array['bottle','ml','l'],365,array['烹饪酒'],array[]::text[]),
  ('食用油','SEASONING','OIL_FAT','ml',array['bottle','ml','l'],365,array['植物油'],array[]::text[])
)
insert into food_catalog
  (canonical_name, category, category_code, default_unit_code, preferred_unit_codes,
   default_shelf_life_days, data_source, source_reference, allergen_codes, review_status)
select name, legacy_category, category_code, unit_code, units, shelf_days,
       'XZ_CURATED', 'XZ_MVP_Engineering_Pack_v1.0 / FR-005', allergens, 'CURATED'
from foods
on conflict do nothing;

with aliases(name, aliases) as (
  values
  ('羊肉',array['羊肉片','mutton']), ('鸡肉',array['鸡','整鸡','chicken']),
  ('鸭肉',array['鸭','整鸭','duck']), ('带鱼',array['刀鱼']), ('鲈鱼',array['花鲈']),
  ('鳕鱼',array['cod']), ('螃蟹',array['蟹','大闸蟹']), ('黑虎虾',array['虎虾','斑节虾']),
  ('鱿鱼',array['鲜鱿']), ('章鱼',array['八爪鱼']), ('扇贝',array['鲜贝']),
  ('生蚝',array['牡蛎','蚝']), ('鸭蛋',array['duck egg']), ('黄油',array['牛油','butter']),
  ('生菜',array['叶用莴苣']), ('白菜',array['大白菜']), ('芹菜',array['西芹']),
  ('莲藕',array['藕']), ('西兰花',array['绿花椰菜']), ('菜花',array['花椰菜','白花菜']),
  ('黄瓜',array['青瓜']), ('南瓜',array['倭瓜']), ('青椒',array['甜椒','柿子椒']),
  ('豆角',array['四季豆']), ('蒜',array['大蒜','蒜头']), ('姜',array['生姜']),
  ('海带',array['昆布']), ('紫菜',array['海苔']), ('橙子',array['甜橙']),
  ('菠萝',array['凤梨']), ('桃',array['桃子']), ('玉米',array['玉米棒','苞米']),
  ('燕麦',array['燕麦片']), ('红薯',array['地瓜','番薯']), ('黄豆',array['大豆']),
  ('腐竹',array['豆腐皮']), ('香菇',array['冬菇']), ('木耳',array['黑木耳']),
  ('花生',array['花生米']), ('核桃',array['核桃仁']), ('食盐',array['盐']),
  ('白糖',array['砂糖','白砂糖']), ('生抽',array['酱油']), ('陈醋',array['醋','食醋']),
  ('料酒',array['烹饪酒']), ('食用油',array['植物油'])
)
insert into food_aliases(food_id, alias, locale)
select fc.id, a.alias, case when a.alias ~ '^[a-zA-Z ]+$' then 'en' else 'zh' end
from aliases src
join food_catalog fc on fc.canonical_name = src.name and fc.household_id is null
cross join lateral unnest(src.aliases) a(alias)
on conflict (food_id, alias) do nothing;

insert into shelf_life_rules(food_id, storage_zone_code, max_days, condition_note, source_reference)
select id, 'FRIDGE', default_shelf_life_days,
       '未开封且冷藏条件正常；包装标示优先于目录默认值。',
       'XZ curated operational default; user/package date overrides'
from food_catalog
where household_id is null and default_shelf_life_days is not null
on conflict (food_id, storage_zone_code) do nothing;

alter table shelf_life_rules enable row level security;
alter table nutrition_profiles enable row level security;
create policy shelf_life_rules_authenticated_select on shelf_life_rules
  for select to authenticated using (true);
create policy nutrition_profiles_authenticated_select on nutrition_profiles
  for select to authenticated using (true);
