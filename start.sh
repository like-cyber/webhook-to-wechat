#!/bin/bash
# ============================================================
# Webhook → 微信 一键启动脚本
# ============================================================

set -e

export PATH="/Users/like/.workbuddy/binaries/node/versions/22.12.0/bin:/Users/like/.workbuddy/binaries:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=${PORT:-3456}

echo ""
echo "=========================================="
echo "  🔗 Webhook → 微信 转发服务"
echo "=========================================="
echo ""

# 检查 WECHAT_TARGET
if [ -z "$WECHAT_TARGET" ]; then
    echo "⚠️  WECHAT_TARGET 未设置！"
    echo ""
    echo "请先获取你要发送消息的微信用户 ID："
    echo "  openclaw message read --channel openclaw-weixin --limit 5"
    echo ""
    echo "找到目标用户的 ID 后，设置环境变量："
    echo "  export WECHAT_TARGET=\"wxid_xxxxxxxx\""
    echo ""
    echo "然后重新运行此脚本。"
    exit 1
fi

echo "📱 微信目标: $WECHAT_TARGET"
echo "🔌 本地端口: $PORT"
echo ""

# 启动 Webhook 服务（后台）
echo "🚀 启动 Webhook 服务..."
node "$SCRIPT_DIR/server.js" &
SERVER_PID=$!
sleep 1

# 检查是否启动成功
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "❌ Webhook 服务启动失败"
    exit 1
fi

echo "✅ Webhook 服务已启动 (PID: $SERVER_PID)"
echo ""

# 启动 ngrok
echo "🌐 启动 ngrok 内网穿透..."
ngrok http $PORT --log stdout --log-level warn &
NGROK_PID=$!
sleep 3

# 获取 ngrok 公网地址
NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https://[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$NGROK_URL" ]; then
    echo ""
    echo "=========================================="
    echo "  ✅ 全部就绪！"
    echo "=========================================="
    echo ""
    echo "  公网 Webhook 地址："
    echo "  🔗 ${NGROK_URL}/webhook"
    echo ""
    echo "  把上面这个地址填到腾讯文档智能表"
    echo "  自动化的 Webhook URL 中即可。"
    echo ""
    echo "  测试链接："
    echo "  🧪 ${NGROK_URL}/test"
    echo ""
    echo "=========================================="
else
    echo ""
    echo "⚠️  ngrok 可能需要认证。请先注册："
    echo "  1. 访问 https://dashboard.ngrok.com/signup"
    echo "  2. 获取 authtoken"
    echo "  3. 运行: ngrok config add-authtoken <你的token>"
    echo "  4. 重新运行此脚本"
    echo ""
    echo "  或者你也可以使用其他内网穿透工具，"
    echo "  只要把本地 $PORT 端口暴露到公网即可。"
fi

echo ""
echo "按 Ctrl+C 停止服务..."
echo ""

# 等待并清理
cleanup() {
    echo ""
    echo "🛑 正在停止服务..."
    kill $SERVER_PID 2>/dev/null
    kill $NGROK_PID 2>/dev/null
    echo "已停止。"
    exit 0
}

trap cleanup INT TERM
wait
