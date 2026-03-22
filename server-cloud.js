/**
 * Webhook → 微信 转发服务（云端部署版）
 * 
 * 通过环境变量配置微信凭证，可部署到 Render / Railway / Vercel 等云平台。
 * 
 * 必须的环境变量:
 *   WEIXIN_API_BASE_URL - 微信 API 地址 (如 https://ilinkai.weixin.qq.com)
 *   WEIXIN_BOT_TOKEN    - 微信 Bot Token
 *   WEIXIN_USER_ID      - 微信目标用户 ID
 *   PORT                - 监听端口（云平台自动提供）
 */

const http = require("http");
const https = require("https");
const crypto = require("crypto");

// ====== 配置 ======
const PORT = process.env.PORT || 3456;
const API_BASE_URL = process.env.WEIXIN_API_BASE_URL;
const BOT_TOKEN = process.env.WEIXIN_BOT_TOKEN;
const TARGET_USER_ID = process.env.WEIXIN_USER_ID;
const CHANNEL_VERSION = process.env.CHANNEL_VERSION || "1.0.2";

if (!API_BASE_URL || !BOT_TOKEN || !TARGET_USER_ID) {
  console.error("❌ 缺少必需的环境变量: WEIXIN_API_BASE_URL, WEIXIN_BOT_TOKEN, WEIXIN_USER_ID");
  process.exit(1);
}

// ====== 微信 API 调用 ======

function generateClientId() {
  return `webhook-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function sendWeixinMessage(text) {
  const url = `${API_BASE_URL}/ilink/bot/sendmessage`;
  const clientId = generateClientId();

  const payload = {
    msg: {
      from_user_id: "",
      to_user_id: TARGET_USER_ID,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text: text } }],
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
        console.log(`  [sendmessage] HTTP ${res.statusCode}: ${data.substring(0, 300)}`);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ messageId: clientId, response: data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 300)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("超时")); });
    req.write(body);
    req.end();
  });
}

// ====== 消息格式化 ======

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
    res.end(JSON.stringify({ status: "ok", service: "webhook-to-wechat" }));
    return;
  }

  // Webhook 端点
  if (req.method === "POST" && (req.url === "/webhook" || req.url === "/")) {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      console.log(`[${new Date().toISOString()}] Webhook: ${body.substring(0, 500)}`);

      try {
        const message = extractMessage(body);
        if (!message || message.trim() === "") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, skipped: true }));
          return;
        }

        await sendWeixinMessage(`📋 智能表通知\n${message}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error(`[ERROR]`, err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // 测试
  if (req.method === "GET" && req.url === "/test") {
    try {
      await sendWeixinMessage("🧪 测试消息 " + new Date().toLocaleString("zh-CN"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "test sent" }));
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
  console.log(`🚀 Webhook → 微信 服务已启动，端口: ${PORT}`);
});
