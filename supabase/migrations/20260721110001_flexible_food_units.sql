-- 同一种食材可按多种合理方式计量，例如土豆既可按“个”也可按重量。
-- preferred_unit_codes 用于语音追问/前端提示；库存批次仍保存实际的规范单位。

alter table food_catalog
  add column preferred_unit_codes text[] not null default '{}';

insert into units (code, name_zh, name_en, kind, base_factor)
values ('jin', '斤', 'catty', 'MASS', 500)
on conflict (code) do nothing;

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
end;
