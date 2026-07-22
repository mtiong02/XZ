#!/bin/bash

# Stop on any error
set -e

echo "🐳 Starting Docker deployment for XZ Platform..."

# 部署凭据只保留在服务器受保护的环境文件中；rsync 不会同步该文件。
if [ -f .env.deploy ]; then
  set -a
  . ./.env.deploy
  set +a
elif [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

if [ -z "${ADMIN_TOKEN:-}" ]; then
  echo "❌ ADMIN_TOKEN is required. Export it in the server shell or load it from the server's protected .env file."
  exit 1
fi

if [ -z "${MINIMAX_API_KEY:-}" ]; then
  echo "❌ MINIMAX_API_KEY is required. Export it in the server shell or load it from the server's protected .env file."
  exit 1
fi

# 1. Build Docker images
echo "🔨 Building Docker images..."
docker compose -p xz-platform build

# 2. Start Docker containers
echo "🚀 Starting Docker containers..."
docker compose -p xz-platform up -d

# 3. Apply DB migrations
echo "🗄️ Running database migrations..."
for f in $(ls -1 supabase/migrations/*.sql 2>/dev/null | sort); do
  echo "Applying migration $f..."
  docker exec -i xz-db psql -U postgres -d postgres < "$f" || true
done

# The legacy migration loop is intentionally tolerant because older migrations
# are not all idempotent. Never treat that tolerance as proof that the current
# family model migration landed; verify its table, voice-task columns, helper
# function, and RLS policies explicitly.
echo "🔎 Verifying household model migration..."
profile_table=$(docker exec xz-db psql -U postgres -d postgres -tAc "select to_regclass('household_meal_profiles')")
profile_columns=$(docker exec xz-db psql -U postgres -d postgres -tAc "select count(*) from information_schema.columns where table_name='voice_jobs' and column_name in ('session_id','turn_id','cancel_requested_at')")
member_helper=$(docker exec xz-db psql -U postgres -d postgres -tAc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='is_household_member'")
profile_policies=$(docker exec xz-db psql -U postgres -d postgres -tAc "select count(*) from pg_policies where tablename='household_meal_profiles' and policyname in ('household_meal_profiles_select','household_meal_profiles_write')")
invite_table=$(docker exec xz-db psql -U postgres -d postgres -tAc "select to_regclass('household_invites')")
invite_columns=$(docker exec xz-db psql -U postgres -d postgres -tAc "select count(*) from information_schema.columns where table_name='household_invites' and column_name in ('code_hash','expires_at','max_uses','used_count')")

if [ -z "$profile_table" ] || [ "$profile_columns" -ne 3 ] || [ "$member_helper" -lt 1 ] || [ "$profile_policies" -ne 2 ] || [ -z "$invite_table" ] || [ "$invite_columns" -ne 4 ]; then
  echo "❌ Household model migration verification failed."
  echo "   profile_table=$profile_table voice_columns=$profile_columns helper=$member_helper policies=$profile_policies invite_table=$invite_table invite_columns=$invite_columns"
  exit 1
fi
echo "✅ Household model migration verified (table, columns, helper, RLS, household invites)."

# 4. Cleanup unused images
echo "🧹 Cleaning up old Docker images..."
docker image prune -f

echo "✅ XZ Platform deployment completed! Status:"
docker ps | grep xz- || docker compose -p xz-platform ps
