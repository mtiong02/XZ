-- 为家庭自定义饮品提供明确的可选叶子分类（例如雪碧、芬达等）。
-- 幂等执行：重复部署不会改变既有分类或别名。
insert into food_categories (code, parent_code, name_zh, name_en, sort_order)
values ('SOFT_DRINK', 'BEVERAGE', '碳酸与汽水', 'Soft drinks', 30)
on conflict (code) do nothing;

insert into food_category_aliases (category_code, alias)
values
  ('SOFT_DRINK', '汽水'),
  ('SOFT_DRINK', '碳酸饮料')
on conflict (category_code, alias) do nothing;

-- 已创建家庭的显示名称也同步更新；区域编码 FRIDGE 保持不变，避免影响规则和库存。
update storage_zones
set name = '保鲜室'
where code = 'FRIDGE' and name in ('冷藏室', '冷藏区');
