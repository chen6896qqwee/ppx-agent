// src/channels/http.js - HTTP 通道 (零依赖)
// 起一个本地 HTTP server, 接收 POST /message 消息, 调 agent 回复
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Channel } from "./base.js";

const MAX_BODY = 1024 * 1024;          // 请求体上限 1MB
const RATE_PER_MIN = 60;               // 每 IP 每分钟最大请求数 (令牌桶)
const RATE_WINDOW_MS = 60_000;

export class HttpChannel extends Channel {
  constructor(agent, { port = 8899, host = "127.0.0.1" } = {}) {
    super("http", agent);
    this.port = port;
    this.host = host;
    this.server = null;
    this.agent = agent;
    this.publicDir = path.join(this.agent.root, "public");
    this.authToken = process.env.PPX_AUTH_TOKEN || this._tokenFromConfig();
    this._buckets = new Map(); // ip -> {tokens, last}
  }

  _tokenFromConfig() {
    try {
      const p = path.join(this.agent.root, "config", "ppx.json");
      if (fs.existsSync(p)) {
        const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
        return (cfg.channels && cfg.channels.http && cfg.channels.http.auth_token) || "";
      }
    } catch {}
    return "";
  }

  // 若未配置 token, 自动生成随机 token 并打印 (类似 Jupyter token)
  _ensureToken() {
    if (this.authToken) return this.authToken;
    this.authToken = crypto.randomBytes(24).toString("hex");
    const port = this.port;
    console.log("");
    console.log("  ⚠️  HTTP 认证 token 未配置, 已自动生成:");
    console.log(`       PPX_AUTH_TOKEN=${this.authToken}`);
    console.log(`     用法: Authorization: Bearer ${this.authToken}`);
    console.log("      (或设置 config/ppx.json 的 channels.http.auth_token)");
    console.log("");
    return this.authToken;
  }

  _authed(req, res) {
    if (!this.authToken) return true; // 兼容旧调用: _ensureToken 在 connect 时已执行
    const h = req.headers["authorization"] || "";
    return h === "Bearer " + this.authToken;
  }

  // 简单令牌桶限流: 每 IP 60 req/min
  _rateLimit(req, res) {
    const ip = req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let b = this._buckets.get(ip);
    if (!b) {
      b = { tokens: RATE_PER_MIN, last: now };
      this._buckets.set(ip, b);
    }
    const refill = Math.floor((now - b.last) / RATE_WINDOW_MS);
    if (refill > 0) {
      b.tokens = Math.min(RATE_PER_MIN, b.tokens + refill * RATE_PER_MIN);
      b.last = now;
    }
    if (b.tokens <= 0) {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
      res.end(JSON.stringify({ error: "rate limited" }));
      return false;
    }
    b.tokens -= 1;
    return true;
  }

  // 读取请求体, 限制大小
  async _readBody(req, res) {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "request too large" }));
        return null;
      }
    }
    return body;
  }

  async connect() {
    this._ensureToken(); // 启动时确保有 token
    this.server = http.createServer(async (req, res) => {
      // CORS
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

      // 静态页面与 /health 不设限, 其余 API 限流
      const reqPath = (req.url || "/").split("?")[0];
      if (!(req.method === "GET" && (reqPath === "/" || reqPath === "/index.html" || reqPath === "/health"))) {
        if (!this._rateLimit(req, res)) return;
      }

      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", agent: this.agent.config.agent?.name || "ppx" }));
        return;
      }

      if (req.method === "POST" && req.url === "/message") {
        if (!this._authed(req, res)) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "unauthorized" })); return; }
        const body = await this._readBody(req, res);
        if (body === null) return;
        try {
          const data = JSON.parse(body);
          const text = data.message || data.text || "";
          if (!text) { res.writeHead(400); res.end(JSON.stringify({ error: "missing message" })); return; }
          const sessionKey = data.sessionId || "default";
          const reply = await this.agent.chat(String(text), { sessionKey });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ reply, sessionId: sessionKey, agent: this.agent.config.agent?.name || "ppx" }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
        return;
      }

      // SSE 流式对话
      if (req.method === "POST" && (req.url === "/message/stream" || req.url === "/chat")) {
        if (!this._authed(req, res)) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "unauthorized" })); return; }
        const body = await this._readBody(req, res);
        if (body === null) return;
        try {
          const data = JSON.parse(body);
          const text = data.message || data.text || "";
          if (!text) { res.writeHead(400); res.end(JSON.stringify({ error: "missing message" })); return; }
          const sessionKey = data.sessionId || "default";
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
          });
          const send = (obj) => res.write("data: " + JSON.stringify(obj) + "\n\n");
          let full = "";
          const reply = await this.agent.chatStream(String(text), {
            sessionKey,
            onDelta: (d) => { full += d; try { send({ type: "delta", content: d }); } catch {} },
          });
          const finalContent = full || reply;
          send({ type: "done", content: finalContent, sessionId: sessionKey });
          res.end();
        } catch (e) {
          try { res.write("data: " + JSON.stringify({ type: "error", error: e.message }) + "\n\n"); } catch {}
          try { res.end(); } catch {}
        }
        return;
      }

      // 会话重置
      if (req.method === "POST" && req.url === "/reset") {
        if (!this._authed(req, res)) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "unauthorized" })); return; }
        const body = await this._readBody(req, res);
        if (body === null) return;
        try {
          const data = JSON.parse(body || "{}");
          this.agent.resetSession(data.sessionId || "default");
        } catch {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // ---- 静态界面 + 可观测 API ----
      // 通用静态文件服务 (public/ 下任意文件, 含 vendor/ 资源, 防路径穿越)
      if (req.method === "GET" && !reqPath.startsWith("/api/") && !["/message","/message/stream","/chat","/reset"].some(p=>reqPath===p)) {
        const rel = reqPath === "/" ? "index.html" : reqPath.replace(/^\//, "");
        const file = path.resolve(this.publicDir, rel);
        if (file.startsWith(this.publicDir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          const ext = path.extname(file).toLowerCase();
          const mime = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml", ".ico":"image/x-icon" }[ext] || "application/octet-stream";
          res.writeHead(200, { "Content-Type": mime });
          res.end(fs.readFileSync(file));
          return;
        }
        if (reqPath !== "/") { res.writeHead(404); res.end("not found"); return; }
      }
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
      // API 端点认证
      const protectedApi = reqPath.startsWith("/api/");
      if (protectedApi && !this._authed(req, res)) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "unauthorized" })); return; }
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
