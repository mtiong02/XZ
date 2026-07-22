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

# 3. Cleanup unused images
echo "🧹 Cleaning up old Docker images..."
docker image prune -f

echo "✅ XZ Platform deployment completed! Status:"
docker ps | grep xz- || docker compose -p xz-platform ps
