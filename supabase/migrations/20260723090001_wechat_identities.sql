-- 微信身份映射。微信 openid/unionid 不是业务用户表的登录密码，也不直接暴露给前端。
create table if not exists wechat_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  open_id text not null,
  union_id text,
  nickname text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (open_id),
  unique (union_id)
);

create index if not exists wechat_identities_user_idx on wechat_identities (user_id);
alter table wechat_identities enable row level security;
