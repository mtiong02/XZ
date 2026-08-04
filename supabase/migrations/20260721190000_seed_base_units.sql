-- 基础单位种子（幂等）。
--
-- 背景：基础单位（个/盒/克/千克…）原本只写在 supabase/seed.sql 里，而 `supabase db reset`
-- 会先按文件名顺序跑完所有 migration、最后才执行 seed.sql。后续从
-- 20260721195001_food_category_taxonomy.sql 起的迁移会 INSERT food_catalog，
-- 其 default_unit_code 外键指向 units——此时 units 尚未 seed，导致全新 reset / CI / 首次部署
-- 报 food_catalog_default_unit_code_fkey 违反外键而中断。
--
-- 此迁移把基础单位提前到「首个插入食材的迁移之前」。对已增量建好的生产库无副作用
-- （units 已存在，on conflict do nothing 为空操作）。

insert into units (code, name_zh, name_en, kind, base_factor) values
  ('piece',  '个',   'piece',      'COUNT',  1),
  ('box',    '盒',   'box',        'COUNT',  1),
  ('bottle', '瓶',   'bottle',     'COUNT',  1),
  ('pack',   '包',   'pack',       'COUNT',  1),
  ('bag',    '袋',   'bag',        'COUNT',  1),
  ('bunch',  '把',   'bunch',      'COUNT',  1),
  ('can',    '罐',   'can',        'COUNT',  1),
  ('jin',    '斤',   'catty',      'MASS',   500),
  ('liang',  '两',   'liang',      'MASS',   50),
  ('g',      '克',   'gram',       'MASS',   1),
  ('kg',     '千克', 'kilogram',   'MASS',   1000),
  ('ml',     '毫升', 'milliliter', 'VOLUME', 1),
  ('l',      '升',   'liter',      'VOLUME', 1000)
on conflict (code) do nothing;
