# XZ 食材分类约定

- The tree lives in `food_categories` using `parent_code`; category queries expand descendants with a recursive CTE.
- A food must use a specific leaf where one exists: `LOBSTER`, `ABALONE`, `SHRIMP`, `PORK`, `BEEF`, `LEAFY_VEGETABLE`, and so on.
- Root and broad nodes (`FOOD`, `MEAT`, `AQUATIC`, `VEGETABLE`) are query vocabulary, not preferred food assignments.
- Individual pronunciations and abbreviations belong in `food_aliases`; examples: `澳洲龙虾 → 澳龙`, `黑虎虾 → 大虾`.
- Units remain explicit. Accept only codes in `units`; store default and preferred codes on `food_catalog`.
- Keep legacy `category` only for compatibility; all new taxonomy behavior uses `category_code`.
