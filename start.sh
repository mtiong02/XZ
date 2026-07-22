#!/bin/sh

set -e

echo "=========================================="
echo "🚀 正在启动 小知 (XZ Platform) 本地服务..."
echo "=========================================="

# 1. 检查并准备本地语音模型（如果缺失则自动下载）
if [ ! -d "local-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en" ] || [ ! -d "local-models/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01" ]; then
    echo "📦 检查到本地语音模型缺失，正在自动下载语音识别与唤醒词模型..."
    if [ -f "scripts/setup-local-speech.sh" ]; then
        chmod +x scripts/setup-local-speech.sh
        ./scripts/setup-local-speech.sh
    fi
fi

# 2. 检查 Docker 运行环境
if ! command -v docker >/dev/null 2>&1; then
    echo "❌ 错误: 未检测到 Docker，请先启动 Docker Desktop！"
    exit 1
fi

# 3. 构建并启动 Docker 容器服务
echo "🐳 正在构建与启动 Docker 容器组 (xz-platform)..."
if docker compose version >/dev/null 2>&1; then
    docker compose -p xz-platform up -d --build
else
    docker-compose -p xz-platform up -d --build
fi

echo ""
echo "=========================================="
echo "🎉 小知 (XZ Platform) 本地服务启动完成！"
echo "=========================================="
echo "🌐 访问入口："
echo "  • 📱 Web 前端应用 : http://localhost:3100"
echo "  • ⚙️  后端 API 服务 : http://localhost:4100"
echo "  • 🎙️ 语音引擎服务 : http://localhost:6010"
echo "  • 🔑 认证服务 (GoTrue): http://localhost:9999"
echo "  • 🗄️  数据库 (Postgres): 127.0.0.1:5433"
echo "=========================================="
echo ""

# 4. 显示当前运行容器状态
if docker compose version >/dev/null 2>&1; then
    docker compose -p xz-platform ps
else
    docker-compose -p xz-platform ps
fi
