/**
 * Webhook → 微信 转发服务
 * 
 * 接收腾讯文档智能表自动化发送的 Webhook 请求，
 * 直接调用微信 ilink API 推送到个人微信。
 * 
 * 用法: node server.js
 * 
 * 环境变量:
 *   PORT - 监听端口（默认 3456）
 */

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ====== 配置 ======
const PORT = process.env.PORT || 3456;

// 从 OpenClaw 微信账号配置中读取凭证
const ACCOUNT_FILE = path.join(
  process.env.HOME || "/Users/like",
  ".openclaw/openclaw-weixin/accounts/d60fe484c464-im-bot.json"
);

let WEIXIN_CONFIG;
try {
  WEIXIN_CONFIG = JSON.parse(fs.readFileSync(ACCOUNT_FILE, "utf-8"));
  console.log("✅ 已读取微信账号配置");
} catch (err) {
  console.error("❌ 无法读取微信账号配置:", ACCOUNT_FILE, err.message);
  process.exit(1);
}

const API_BASE_URL = WEIXIN_CONFIG.baseUrl; // https://ilinkai.weixin.qq.com
const BOT_TOKEN = WEIXIN_CONFIG.token;      // d60fe484c464@im.bot:060000017f1f633a38b61a44fba5d57bd69709
const TARGET_USER_ID = WEIXIN_CONFIG.userId; // o9cq80xZ7TU_mq72G0xjg6UiEj4o@im.wechat

// 读取插件版本
let CHANNEL_VERSION = "unknown";
try {
  const pkgPath = path.join(
    process.env.HOME || "/Users/like",
    ".openclaw/extensions/openclaw-weixin/package.json"
  );
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  CHANNEL_VERSION = pkg.version || "unknown";
} catch {}

// ====== 微信 API 调用 ======

function generateClientId() {
  return `openclaw-weixin-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

/**
 * 直接调用微信 ilink/bot/sendmessage API 发送消息
 * 先获取 contextToken，再发送消息
 */
async function getContextTokenFromAPI(userId) {
  const url = `${API_BASE_URL}/ilink/bot/getconfig`;
  const body = JSON.stringify({
    ilink_user_id: userId,
    base_info: { channel_version: CHANNEL_VERSION },
  });

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "AuthorizationType": "ilink_bot_token",
        "Authorization": `Bearer ${BOT_TOKEN}`,
        "Content-Length": Buffer.byteLength(body, "utf-8"),
        "X-WECHAT-UIN": randomWechatUin(),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const resp = JSON.parse(data);
          console.log(`  [getconfig] 响应:`, JSON.stringify(resp).substring(0, 200));
          resolve(resp);
        } catch (e) {
          reject(new Error(`解析 getconfig 响应失败: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("getconfig 超时")); });
    req.write(body);
    req.end();
  });
}

async function sendWeixinMessage(text, contextToken) {
  const url = `${API_BASE_URL}/ilink/bot/sendmessage`;
  const clientId = generateClientId();

  const payload = {
    msg: {
      from_user_id: "",
      to_user_id: TARGET_USER_ID,
      client_id: clientId,
      message_type: 2, // BOT
      message_state: 2, // FINISH
      item_list: [{ type: 1, text_item: { text: text } }], // TEXT
      context_token: contextToken || undefined,
    },
    base_info: { channel_version: CHANNEL_VERSION },
  };

  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "AuthorizationType": "ilink_bot_token",
        "Authorization": `Bearer ${BOT_TOKEN}`,
        "Content-Length": Buffer.byteLength(body, "utf-8"),
        "X-WECHAT-UIN": randomWechatUin(),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        console.log(`  [sendmessage] HTTP ${res.statusCode}, 响应: ${data.substring(0, 300)}`);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ messageId: clientId, response: data });
        } else {
          reject(new Error(`发送失败 HTTP ${res.statusCode}: ${data.substring(0, 300)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("sendmessage 超时")); });
    req.write(body);
    req.end();
  });
}

/**
 * 发送消息到微信（完整流程）
 */
async function sendToWechat(message) {
  console.log(`[${new Date().toISOString()}] 准备发送微信消息...`);

  // 步骤1: 尝试获取 contextToken
  let contextToken;
  try {
    const config = await getContextTokenFromAPI(TARGET_USER_ID);
    // getconfig 不直接返回 context_token，但可能有其他有用信息
    // context_token 主要是从 getUpdates 的消息中来的
    // 我们尝试不带 contextToken 直接发送
  } catch (err) {
    console.log(`  [warn] getconfig 失败: ${err.message}，继续尝试发送...`);
  }

  // 步骤2: 发送消息（先尝试不带 contextToken）
  try {
    const result = await sendWeixinMessage(message, contextToken);
    console.log(`  [OK] 消息发送成功, clientId: ${result.messageId}`);
    return result;
  } catch (err) {
    console.error(`  [ERROR] 消息发送失败: ${err.message}`);
    throw err;
  }
}

// ====== Webhook 消息提取 ======

function extractMessage(body) {
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return body; }
  }
  if (body.message) return String(body.message);
  if (body.text) return String(body.text);
  if (body.content) return String(body.content);
  if (body.msg) return String(body.msg);
  if (body.data) {
    if (typeof body.data === "string") return body.data;
    return formatRecord(body.data);
  }
  if (Array.isArray(body)) {
    return body.map((item, i) => `[${i + 1}] ${formatRecord(item)}`).join("\n");
  }
  return formatRecord(body);
}

function formatRecord(record) {
  if (typeof record !== "object" || record === null) return String(record);
  const lines = [];
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith("_") || key === "id" || key === "recordId") continue;
    lines.push(`${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
  }
  return lines.join("\n") || JSON.stringify(record, null, 2);
}

// ====== HTTP 服务器 ======
const server = http.createServer(async (req, res) => {
  // CORS 支持
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // 健康检查
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      service: "webhook-to-wechat",
      target: TARGET_USER_ID ? `${TARGET_USER_ID.substring(0, 10)}...` : "NOT_SET",
      uptime: process.uptime(),
    }));
    return;
  }

  // Webhook 接收端点
  if (req.method === "POST" && (req.url === "/webhook" || req.url === "/")) {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      console.log(`\n[${new Date().toISOString()}] 收到 Webhook:`);
      console.log(`  Body: ${body.substring(0, 500)}`);

      try {
        const message = extractMessage(body);
        if (!message || message.trim() === "") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, skipped: true, reason: "empty message" }));
          return;
        }

        const fullMessage = `📋 智能表通知\n${message}`;
        await sendToWechat(fullMessage);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, message: "sent to wechat" }));
      } catch (err) {
        console.error(`[ERROR]`, err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 测试端点
  if (req.method === "GET" && req.url === "/test") {
    try {
      await sendToWechat("🧪 Webhook 测试消息\n如果你收到这条消息，说明 Webhook → 微信转发链路正常！\n" + new Date().toLocaleString("zh-CN"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "test message sent" }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`\n🚀 Webhook → 微信 转发服务已启动`);
  console.log(`   监听端口: ${PORT}`);
  console.log(`   Webhook 地址: http://localhost:${PORT}/webhook`);
  console.log(`   测试发送: http://localhost:${PORT}/test`);
  console.log(`   微信目标: ${TARGET_USER_ID}`);
  console.log(`   API 地址: ${API_BASE_URL}`);
  console.log(`\n   等待 Webhook 请求...\n`);
});
