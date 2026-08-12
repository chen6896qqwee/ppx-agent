// src/channels/http.js - HTTP 通道 (零依赖)
// 起一个本地 HTTP server, 接收 POST /message 消息, 调 agent 回复
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Channel } from "./base.js";

export class HttpChannel extends Channel {
  constructor(agent, { port = 8899, host = "127.0.0.1" } = {}) {
    super("http", agent);
    this.port = port;
    this.host = host;
    this.server = null;
    this.agent = agent;
    this.publicDir = path.join(this.agent.root, "public");
  }

  async connect() {
    this.server = http.createServer(async (req, res) => {
      // CORS
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", agent: this.agent.config.agent?.name || "ppx" }));
        return;
      }

      if (req.method === "POST" && req.url === "/message") {
        let body = "";
        for await (const chunk of req) body += chunk;
        try {
          const data = JSON.parse(body);
          const text = data.message || data.text || "";
          if (!text) { res.writeHead(400); res.end(JSON.stringify({ error: "missing message" })); return; }
          const reply = await this.agent.chat(String(text));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ reply, agent: this.agent.config.agent?.name || "ppx" }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
        return;
      }

      // ---- 静态界面 + 可观测 API ----
      const reqPath = (req.url || "/").split("?")[0];
      // 静态页面
      if (req.method === "GET" && (reqPath === "/" || reqPath === "/index.html")) {
        const html = path.join(this.publicDir, "index.html");
        if (fs.existsSync(html)) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(fs.readFileSync(html, "utf8"));
        } else {
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("皮皮虾服务已启动。public/index.html 未找到。");
        }
        return;
      }
      // 轨迹 API
      if (req.method === "GET" && reqPath === "/api/traces") {
        const limit = Number((req.url.split("limit=")[1] || "").split("&")[0] || 50);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.agent.traces.read(undefined, limit)));
        return;
      }
      // 统计 API
      if (req.method === "GET" && reqPath === "/api/stats") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.agent.traces.stats()));
        return;
      }
      // 记忆 API
      if (req.method === "GET" && reqPath === "/api/memory") {
        res.writeHead(200, { "Content-Type": "application/json" });
        const facts = this.agent.facts ? this.agent.facts.list().slice(0, 20).map((f) => ({ content: f.content, score: f.score, type: f.type })) : [];
        const scenes = this.agent.scenes ? this.agent.scenes.listWithDesc().slice(-10) : [];
        res.end(JSON.stringify({ facts, scenes }));
        return;
      }

      res.writeHead(404); res.end("not found");

    });

    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, resolve);
    });
    this.connected = true;
    return this;
  }

  async send(to, text) { return text; } // HTTP 是请求-响应, 直接返回

  async disconnect() {
    if (this.server) { await new Promise((r) => this.server.close(r)); this.server = null; }
    this.connected = false;
  }
}