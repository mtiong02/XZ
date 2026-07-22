#!/bin/bash

# Stop on any error
set -e

echo "🐳 Starting Docker deployment for XZ Platform..."

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
