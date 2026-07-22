-- 清理数据库中重复/同质化的菜谱条目与关联食材
delete from recipe_ingredients where recipe_id in (
  select id from recipes where name in ('土豆炖牛腩', '牛肉炖土豆') and id != 'rec-03'::uuid
);
delete from recipes where name in ('土豆炖牛腩', '牛肉炖土豆') and id != 'rec-03'::uuid;

-- 确保 rec-03 名称统一规范为经典“土豆炖牛肉”
update recipes set name = '土豆炖牛肉' where id = 'rec-03'::uuid;
