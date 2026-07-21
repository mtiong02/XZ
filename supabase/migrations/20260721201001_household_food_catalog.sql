-- 家庭自定义食材的同名保护：避免与全局目录或本家庭目录产生语音歧义。
create unique index food_catalog_household_name_uq
  on food_catalog (household_id, canonical_name)
  where household_id is not null;
