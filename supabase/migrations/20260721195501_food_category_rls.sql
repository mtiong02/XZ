-- 分类树是 Food Knowledge 公共只读资料，认证用户可读。

alter table food_categories enable row level security;
create policy food_categories_authenticated_select on food_categories
  for select to authenticated
  using (true);

alter table food_category_aliases enable row level security;
create policy food_category_aliases_authenticated_select on food_category_aliases
  for select to authenticated
  using (true);
