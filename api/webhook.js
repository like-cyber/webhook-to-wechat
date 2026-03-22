/**
 * Vercel Serverless Function: Webhook → 微信转发
 * 
 * 优化：先快速返回 200，用 waitUntil 异步发微信消息
 */
const https = require("https");
const crypto = require("crypto");

const API_BASE_URL = process.env.WEIXIN_API_BASE_URL;
const BOT_TOKEN = process.env.WEIXIN_BOT_TOKEN;
const TARGET_USER_ID = process.env.WEIXIN_USER_ID;
const CHANNEL_VERSION = process.env.CHANNEL_VERSION || "1.0.2";

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

function sendWeixinMessage(text) {
  const url = `${API_BASE_URL}/ilink/bot/sendmessage`;
  const clientId = `webhook-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  const payload = {
    msg: {
      from_user_id: "",
      to_user_id: TARGET_USER_ID,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text } }],
    },
    base_info: { channel_version: CHANNEL_VERSION },
  };

  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
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
        console.log(`[sendmessage] HTTP ${res.statusCode}: ${data.substring(0, 200)}`);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ messageId: clientId, response: data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 300)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error("微信API超时(8s)")); });
    req.write(body);
    req.end();
  });
}

function extractMessage(body) {
  // 如果是纯文本字符串（腾讯文档 raw 模式可能发纯文本）
  if (typeof body === "string") {
    const trimmed = body.trim();
    // 尝试解析为 JSON
    try { body = JSON.parse(trimmed); } catch {
      // 不是 JSON，就当纯文本用
      return trimmed;
    }
  }
  // 如果 body 不是对象（比如数字、布尔），直接转字符串
  if (typeof body !== "object" || body === null) return String(body);
  // 优先取常见字段
  if (body.message) return String(body.message);
  if (body.text) return String(body.text);
  if (body.content) return String(body.content);
  if (body.msg && typeof body.msg === "string") return body.msg;
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

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // GET = 健康检查
  if (req.method === "GET") {
    return res.status(200).json({ status: "ok", service: "webhook-to-wechat" });
  }

  // POST = webhook
  if (req.method === "POST") {
    const message = extractMessage(req.body || "");
    if (!message || message.trim() === "") {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const startTime = Date.now();
    console.log(`[webhook] 收到消息，开始发送微信通知`);

    try {
      await sendWeixinMessage(`📋 智能表通知\n${message}`);
      const elapsed = Date.now() - startTime;
      console.log(`[OK] 微信消息发送成功，耗时 ${elapsed}ms`);
      return res.status(200).json({ ok: true });
    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.error(`[ERROR] 微信消息发送失败 (${elapsed}ms):`, err.message);
      // 即使失败也返回 200，避免腾讯文档重试
      return res.status(200).json({ ok: true, wechat_error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
