-- 扩充基础食材知识库，让所有分类下均包含常见家庭食材。

with foods(name, legacy_category, category_code, unit_code, units, shelf_days) as (
  values
    -- 蔬菜 (VEGETABLE)
    ('西兰花', 'VEGETABLE', 'VEGETABLE', 'g', array['g','jin','kg','piece'], 5),
    ('包菜', 'VEGETABLE', 'VEGETABLE', 'g', array['g','jin','kg','piece'], 7),
    ('黄瓜', 'VEGETABLE', 'VEGETABLE', 'piece', array['piece','jin','g','kg'], 5),
    ('苦瓜', 'VEGETABLE', 'VEGETABLE', 'piece', array['piece','jin','g','kg'], 5),
    ('丝瓜', 'VEGETABLE', 'VEGETABLE', 'piece', array['piece','jin','g','kg'], 3),
    ('冬笋', 'VEGETABLE', 'VEGETABLE', 'g', array['g','jin','kg'], 7),
    ('莲藕', 'VEGETABLE', 'VEGETABLE', 'g', array['g','jin','kg'], 7),
    ('韭菜', 'VEGETABLE', 'VEGETABLE', 'bunch', array['bunch','jin','g'], 3),
    ('空心菜', 'VEGETABLE', 'VEGETABLE', 'bunch', array['bunch','jin','g'], 2),
    ('油麦菜', 'VEGETABLE', 'VEGETABLE', 'bunch', array['bunch','jin','g'], 3),
    ('小白菜', 'VEGETABLE', 'VEGETABLE', 'bunch', array['bunch','jin','g'], 3),
    ('茼蒿', 'VEGETABLE', 'VEGETABLE', 'bunch', array['bunch','jin','g'], 3),
    ('胡萝卜', 'VEGETABLE', 'VEGETABLE', 'g', array['g','jin','kg','piece'], 14),
    ('白萝卜', 'VEGETABLE', 'VEGETABLE', 'g', array['g','jin','kg','piece'], 10),
    ('红薯', 'VEGETABLE', 'VEGETABLE', 'g', array['g','jin','kg','piece'], 20),
    ('山药', 'VEGETABLE', 'VEGETABLE', 'g', array['g','jin','kg','piece'], 15),
    ('洋葱', 'VEGETABLE', 'VEGETABLE', 'piece', array['piece','jin','g','kg'], 20),
    ('青椒', 'VEGETABLE', 'VEGETABLE', 'g', array['g','jin','kg','piece'], 7),
    ('彩椒', 'VEGETABLE', 'VEGETABLE', 'g', array['g','jin','kg','piece'], 7),
    ('大蒜', 'VEGETABLE', 'VEGETABLE', 'piece', array['piece','jin','g'], 30),
    ('香菜', 'VEGETABLE', 'VEGETABLE', 'bunch', array['bunch','g'], 4),

    -- 水果 (FRUIT)
    ('香蕉', 'FRUIT', 'FRUIT', 'piece', array['piece','jin','kg','bunch'], 5),
    ('葡萄', 'FRUIT', 'FRUIT', 'g', array['g','jin','kg','box'], 4),
    ('水蜜桃', 'FRUIT', 'FRUIT', 'piece', array['piece','jin','kg','box'], 5),
    ('芒果', 'FRUIT', 'FRUIT', 'piece', array['piece','jin','kg','box'], 6),
    ('梨', 'FRUIT', 'FRUIT', 'piece', array['piece','jin','kg','box'], 10),
    ('木瓜', 'FRUIT', 'FRUIT', 'piece', array['piece','jin','kg'], 7),
    ('猕猴桃', 'FRUIT', 'FRUIT', 'piece', array['piece','box','jin','kg'], 7),
    ('火龙果', 'FRUIT', 'FRUIT', 'piece', array['piece','jin','kg'], 7),
    ('草莓', 'FRUIT', 'FRUIT', 'box', array['box','g','jin'], 3),
    ('蓝莓', 'FRUIT', 'FRUIT', 'box', array['box','g'], 5),
    ('柠檬', 'FRUIT', 'FRUIT', 'piece', array['piece','jin','kg'], 20),
    ('哈密瓜', 'FRUIT', 'FRUIT', 'piece', array['piece','jin','kg'], 10),
    ('柚子', 'FRUIT', 'FRUIT', 'piece', array['piece','jin','kg'], 15),

    -- 肉禽蛋 (MEAT, EGG)
    ('鸡翅', 'MEAT', 'POULTRY', 'g', array['piece','jin','g','kg','pack'], 3),
    ('鸡腿', 'MEAT', 'POULTRY', 'g', array['piece','jin','g','kg','pack'], 3),
    ('鸭肉', 'MEAT', 'POULTRY', 'g', array['jin','g','kg'], 3),
    ('羊肉', 'MEAT', 'MEAT', 'g', array['jin','g','kg','pack'], 3),
    ('牛排', 'MEAT', 'MEAT', 'piece', array['piece','g','pack'], 5),
    ('猪排骨', 'MEAT', 'MEAT', 'g', array['jin','g','kg','pack'], 3),
    ('五花肉', 'MEAT', 'MEAT', 'g', array['jin','g','kg'], 3),
    ('培根', 'MEAT', 'PROCESSED_MEAT', 'pack', array['pack','g'], 14),
    ('鸭蛋', 'EGG_DAIRY', 'EGG', 'piece', array['piece','box'], 25),
    ('鹌鹑蛋', 'EGG_DAIRY', 'EGG', 'box', array['box','piece','g'], 20),

    -- 水产海鲜 (AQUATIC)
    ('鲜虾', 'SEAFOOD', 'CRUSTACEAN', 'g', array['jin','g','kg','box'], 2),
    ('螃蟹', 'SEAFOOD', 'CRUSTACEAN', 'piece', array['piece','jin'], 2),
    ('鲈鱼', 'SEAFOOD', 'FISH', 'piece', array['piece','jin','g'], 2),
    ('三文鱼', 'SEAFOOD', 'FISH', 'g', array['g','pack','jin'], 2),
    ('带鱼', 'SEAFOOD', 'FISH', 'g', array['jin','g','kg'], 2),
    ('鱿鱼', 'SEAFOOD', 'MOLLUSK', 'g', array['jin','g','piece'], 2),
    ('蛤蜊', 'SEAFOOD', 'MOLLUSK', 'g', array['jin','g','kg'], 2),
    ('扇贝', 'SEAFOOD', 'MOLLUSK', 'piece', array['piece','jin','g'], 2),

    -- 奶类乳品 (DAIRY)
    ('纯牛奶', 'EGG_DAIRY', 'DAIRY', 'box', array['box','pack','bottle'], 30),
    ('酸奶', 'EGG_DAIRY', 'DAIRY', 'bottle', array['bottle','box'], 14),
    ('奶酪', 'EGG_DAIRY', 'DAIRY', 'pack', array['pack','g','piece'], 30),
    ('黄油', 'EGG_DAIRY', 'DAIRY', 'pack', array['pack','g'], 60),
    ('稀奶油', 'EGG_DAIRY', 'DAIRY', 'box', array['box','ml'], 14),

    -- 主食杂粮 (GRAIN_STAPLE)
    ('米饭', 'STAPLE', 'GRAIN_STAPLE', 'piece', array['piece','g'], 2),
    ('面条', 'STAPLE', 'GRAIN_STAPLE', 'pack', array['pack','g','jin'], 90),
    ('馒头', 'STAPLE', 'GRAIN_STAPLE', 'piece', array['piece','bag'], 3),
    ('包子', 'STAPLE', 'GRAIN_STAPLE', 'piece', array['piece','bag'], 3),
    ('水饺', 'STAPLE', 'GRAIN_STAPLE', 'bag', array['bag','piece','pack'], 60),
    ('大米', 'STAPLE', 'GRAIN_STAPLE', 'kg', array['kg','jin','bag'], 180),
    ('小米', 'STAPLE', 'GRAIN_STAPLE', 'kg', array['kg','jin','bag'], 180),
    ('玉米', 'STAPLE', 'GRAIN_STAPLE', 'piece', array['piece','jin'], 5),
    ('意面', 'STAPLE', 'GRAIN_STAPLE', 'pack', array['pack','g'], 365),

    -- 豆制品坚果 (LEGUME_SOY)
    ('豆腐', 'OTHER', 'LEGUME_SOY', 'piece', array['piece','box','g'], 3),
    ('豆干', 'OTHER', 'LEGUME_SOY', 'pack', array['pack','g','jin'], 7),
    ('腐竹', 'OTHER', 'LEGUME_SOY', 'pack', array['pack','g'], 90),
    ('豆浆', 'OTHER', 'LEGUME_SOY', 'bottle', array['bottle','ml'], 2),
    ('核桃', 'OTHER', 'LEGUME_SOY', 'bag', array['bag','g','jin'], 180),
    ('花生', 'OTHER', 'LEGUME_SOY', 'bag', array['bag','g','jin'], 180),
    ('腰果', 'OTHER', 'LEGUME_SOY', 'bag', array['bag','g'], 180),

    -- 菌菇海藻 (FUNGI)
    ('香菇', 'VEGETABLE', 'FUNGI', 'g', array['g','jin','pack'], 5),
    ('金针菇', 'VEGETABLE', 'FUNGI', 'pack', array['pack','g'], 5),
    ('木耳', 'VEGETABLE', 'FUNGI', 'g', array['g','pack','jin'], 180),
    ('平菇', 'VEGETABLE', 'FUNGI', 'g', array['g','pack','jin'], 4),
    ('杏鲍菇', 'VEGETABLE', 'FUNGI', 'piece', array['piece','g','pack'], 7),

    -- 调味料 (SEASONING)
    ('生抽', 'OTHER', 'SEASONING', 'bottle', array['bottle','ml'], 365),
    ('老抽', 'OTHER', 'SEASONING', 'bottle', array['bottle','ml'], 365),
    ('蚝油', 'OTHER', 'SEASONING', 'bottle', array['bottle','g'], 180),
    ('陈醋', 'OTHER', 'SEASONING', 'bottle', array['bottle','ml'], 365),
    ('料酒', 'OTHER', 'SEASONING', 'bottle', array['bottle','ml'], 365),
    ('芝麻油', 'OTHER', 'SEASONING', 'bottle', array['bottle','ml'], 365),
    ('食用油', 'OTHER', 'SEASONING', 'bottle', array['bottle','l'], 365),
    ('盐', 'OTHER', 'SEASONING', 'bag', array['bag','g'], 730),
    ('白糖', 'OTHER', 'SEASONING', 'bag', array['bag','g'], 365),
    ('辣椒酱', 'OTHER', 'SEASONING', 'bottle', array['bottle','g'], 180),
    ('番茄酱', 'OTHER', 'SEASONING', 'bottle', array['bottle','g'], 180),

    -- 饮品 (BEVERAGE)
    ('矿泉水', 'OTHER', 'BEVERAGE', 'bottle', array['bottle','box'], 365),
    ('可乐', 'OTHER', 'BEVERAGE', 'box', array['box','bottle','pack'], 365),
    ('绿茶饮料', 'OTHER', 'BEVERAGE', 'bottle', array['bottle','box'], 180),
    ('果汁', 'OTHER', 'BEVERAGE', 'bottle', array['bottle','box'], 30),
    ('咖啡饮料', 'OTHER', 'BEVERAGE', 'box', array['box','bottle'], 180),
    ('气泡水', 'OTHER', 'BEVERAGE', 'bottle', array['bottle','box'], 365),

    -- 即食加工 (PROCESSED_FOOD)
    ('方便面', 'OTHER', 'PROCESSED_FOOD', 'pack', array['pack','box'], 180),
    ('三明治', 'OTHER', 'PROCESSED_FOOD', 'piece', array['piece','pack'], 2),
    ('火腿肠', 'OTHER', 'PROCESSED_FOOD', 'pack', array['pack','piece'], 180),
    ('汤圆', 'STAPLE', 'PROCESSED_FOOD', 'bag', array['bag','pack'], 180),
    ('烧麦', 'STAPLE', 'PROCESSED_FOOD', 'pack', array['pack','piece'], 30)
)
insert into food_catalog
  (canonical_name, category, category_code, default_unit_code, preferred_unit_codes,
   default_shelf_life_days, data_source, source_reference, review_status)
select name, legacy_category, category_code, unit_code, units, shelf_days,
       'XZ_CURATED', 'XZ expanded catalog 2026-07-22', 'CURATED'
from foods
on conflict do nothing;
