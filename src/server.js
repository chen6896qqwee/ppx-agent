// src/server.js - 皮皮虾 HTTP 服务入口
// 提供: /health, /message (HTTP通道), /feishu/webhook, /wechat/webhook
import http from "node:http";
import { PPXAgent } from "./agent/index.js";
import { HttpChannel } from "./channels/http.js";
import { FeishuChannel } from "./channels/feishu.js";
import { WechatWebhookChannel } from "./channels/wechat.js";

export async function startServer({ root = process.cwd(), port = 8899, host = "127.0.0.1", config = {} } = {}) {
  const agent = new PPXAgent({ root });
  const channels = config.channels || {};

  // HTTP 通道
  const httpCh = new HttpChannel(agent, { port, host });
  await httpCh.connect();

  // 飞书 / 微信 适配器
  const feishu = channels.feishu?.enabled ? new FeishuChannel(agent, channels.feishu) : null;
  const wechat = channels.wechat?.enabled ? new WechatWebhookChannel(agent, channels.wechat) : null;
  if (feishu) { try { await feishu.connect(); } catch (e) { console.warn("[feishu]", e.message); } }
  if (wechat) await wechat.connect();

  // 在 HTTP server 上挂 webhook 路由
  const server = httpCh.server;
  const origHandler = server.listeners("request")[0];
  server.removeAllListeners("request");
  server.on("request", async (req, res) => {
    // webhook 路由优先
    if (feishu && req.url === feishu.webhookPath && req.method === "POST") {
      let body = ""; for await (const c of req) body += c;
      try {
        const out = await feishu.handleWebhook(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
      return;
    }
    if (wechat && req.url === wechat.path && req.method === "POST") {
      let body = ""; for await (const c of req) body += c;
      try {
        const out = await wechat.handleWebhook(body);
        if (out.xml) { res.writeHead(200, { "Content-Type": "text/xml" }); res.end(out.xml); }
        else { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(out)); }
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
      return;
    }
    // 其余走原 HTTP 通道
    origHandler(req, res);
  });

  return { agent, server, feishu, wechat, http: httpCh };
}

// 直接运行
const _entry = (process.argv[1] || "").replace(/\\/g, "/");
if (_entry.endsWith("src/server.js")) {
  const port = Number(process.env.PPX_PORT || 8899);
  const { agent, server } = await startServer({ root: process.cwd(), port });
  console.log(`皮皮虾 服务已启动: http://127.0.0.1:${port}`);
  console.log(`  /health   健康检查`);
  console.log(`  /message  HTTP 对话通道 (POST {message})`);
  console.log(`  工具: ${agent.tools.list().join(", ")}`);
  console.log("  Ctrl+C 退出");
  process.on("SIGINT", () => { agent.shutdown(); process.exit(0); });
}