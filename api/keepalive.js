/**
 * Vercel Cron Job: 定时保活微信 Bot
 * 
 * 每 5 分钟调用一次 getconfig，防止 bot 休眠导致 ret:-2
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

function callGetConfig() {
  const url = `${API_BASE_URL}/ilink/bot/getconfig`;
  const body = JSON.stringify({
    ilink_user_id: TARGET_USER_ID,
    base_info: { channel_version: CHANNEL_VERSION },
  });

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
        console.log(`[keepalive] getconfig HTTP ${res.statusCode}: ${data.substring(0, 100)}`);
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("keepalive 超时")); });
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  console.log(`[keepalive] ${new Date().toISOString()} 开始保活`);
  
  try {
    const result = await callGetConfig();
    console.log(`[keepalive] 保活成功`);
    return res.status(200).json({ ok: true, keepalive: "success", result: result.body.substring(0, 50) });
  } catch (err) {
    console.error(`[keepalive] 保活失败:`, err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
