# Food Knowledge 分类树

分类表为 `food_categories`，使用 `parent_code` 邻接关系；`food_catalog.category_code` 指向最具体节点。分类口语别名存放于 `food_category_aliases`。祖先分类查询必须使用 recursive CTE 展开全部后代，不能比较旧的扁平 `category` 字段。

主干如下：

```text
FOOD
├── ANIMAL_FOOD
│   ├── MEAT → LIVESTOCK_MEAT / POULTRY → PORK / BEEF / LAMB
│   ├── AQUATIC → FISH / CRUSTACEAN / MOLLUSK → LOBSTER / SHRIMP / ABALONE
│   ├── EGG
│   └── DAIRY → LIQUID_DAIRY / FERMENTED_DAIRY / CHEESE
├── PLANT_FOOD
│   ├── VEGETABLE → LEAFY_VEGETABLE / ROOT_TUBER / ALLIUM / FRUIT_VEGETABLE / CRUCIFEROUS
│   ├── FRUIT → POME_FRUIT / CITRUS_FRUIT / BERRY_FRUIT / TROPICAL_FRUIT / STONE_FRUIT / MELON_FRUIT
│   ├── GRAIN_STAPLE → RICE_GRAIN / WHEAT_PRODUCT
│   └── LEGUME_SOY → SOY_PRODUCT / LEGUME
├── FUNGI
├── SEASONING → SPICE / SAUCE / OIL_FAT / SALT_SUGAR / AROMATIC
└── PROCESSED_FOOD
```

扩展原则：优先复用节点；只有查询语义确实需要时才增加层级。分类不是存储区域，也不是烹饪状态。一个标准食材当前只挂一个主要分类；未来确需多标签时另建标签关系，不复用树结构表达过敏原、营养或菜系。
