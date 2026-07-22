-- 彻底强行矫正数据库中所有 Food Catalog 记录的 category_code，确保完全对齐膳食指南大类

-- 调味料 (SEASONING)
update food_catalog set category_code = 'SEASONING'
where canonical_name in ('生抽','老抽','陈醋','蚝油','料酒','芝麻油','食用油','盐','食盐','白糖','辣椒酱','番茄酱','味精','鸡精','花椒','八角');

-- 奶类乳品 (DAIRY)
update food_catalog set category_code = 'DAIRY'
where canonical_name in ('纯牛奶','牛奶','酸奶','奶酪','黄油','稀奶油','炼乳','芝士');

-- 蔬菜 (VEGETABLE)
update food_catalog set category_code = 'VEGETABLE'
where canonical_name in ('油麦菜','西兰花','包菜','黄瓜','苦瓜','丝瓜','冬笋','莲藕','韭菜','空心菜','小白菜','茼蒿','胡萝卜','白萝卜','红薯','山药','洋葱','青椒','彩椒','大蒜','香菜','茄子','土豆','冬瓜','南瓜','菠菜','生菜','芹菜');

-- 饮品 (BEVERAGE)
update food_catalog set category_code = 'BEVERAGE'
where canonical_name in ('矿泉水','纯净水','红酒','啤酒','白酒','洋酒','黄酒','可乐','绿茶饮料','果汁','咖啡饮料','气泡水','汽水');

-- 豆制品坚果 (LEGUME_SOY)
update food_catalog set category_code = 'LEGUME_SOY'
where canonical_name in ('豆腐','豆干','腐竹','豆浆','豆皮','毛豆','蚕豆','黄豆','绿豆','黑豆','红豆','核桃','花生','腰果','杏仁','坚果','松子','开心果');

-- 菌菇海藻 (FUNGI)
update food_catalog set category_code = 'FUNGI'
where canonical_name in ('香菇','金针菇','木耳','平菇','杏鲍菇','银耳','茶树菇');

-- 水产海鲜 (AQUATIC)
update food_catalog set category_code = 'AQUATIC'
where canonical_name in ('鲜虾','虾','螃蟹','蟹','鲈鱼','三文鱼','带鱼','鱿鱼','蛤蜊','扇贝','巴沙鱼','澳洲龙虾','龙虾','生蚝','章鱼','鲍鱼','鳕鱼','黑虎虾','海带','紫菜');

-- 即食加工 (PROCESSED_FOOD)
update food_catalog set category_code = 'PROCESSED_FOOD'
where canonical_name in ('方便面','三明治','火腿肠','汤圆','烧麦','罐头');
