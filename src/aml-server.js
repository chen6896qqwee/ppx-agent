// src/aml-server.js - AML (Agent Memory Leaderboard) 适配服务
// 提供 Add + Search 契约, 映射进 FactStore (BM25 + bigram 检索, scope 隔离)
// 端点:
//   POST /v1/memories/add    同步存储 (消息完整落盘且可检索后才返回), 回显 request_id
//   POST /v1/memories/search query + scope + top_k 检索
//   GET  /health
// 鉴权: PPX_AML_AUTH = token|bearer|x-api-key|none (默认 none)
//       PPX_AML_AUTH_VALUE = 对应密钥
// 启动: node src/aml-server.js   (监听 PPX_AML_PORT, 默认 8900)
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FactStore } from "./memory/fact-store.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PPX_AML_PORT || 8900);
const DATA = process.env.PPX_AML_DATA || path.join(ROOT, "data", "aml");
const AUTH_SCHEME = (process.env.PPX_AML_AUTH || "none").toLowerCase();
const AUTH_VALUE = process.env.PPX_AML_AUTH_VALUE || "";
const MAX_BODY = 1024 * 1024; // 1MB 请求体上限, 防滥用

const store = new FactStore(DATA, {});

function authOk(req) {
  if (AUTH_SCHEME === "none") return true;
  if (AUTH_SCHEME === "token") return req.headers.authorization === "Token " + AUTH_VALUE;
  if (AUTH_SCHEME === "bearer") return req.headers.authorization === "Bearer " + AUTH_VALUE;
  if (AUTH_SCHEME === "x-api-key") return req.headers["x-api-key"] === AUTH_VALUE;
  return false;
}

// 读取请求体, 带大小上限 (超限/非法 JSON 返回 null)
function readBody(req, maxBytes = MAX_BODY) {
  return new Promise((resolve) => {
    let d = "";
    let tooBig = false;
    req.on("data", (c) => {
      d += c;
      if (Buffer.byteLength(d) > maxBytes) { tooBig = true; req.destroy(); }
    });
    req.on("end", () => {
      if (tooBig) return resolve(null);
      try { resolve(JSON.parse(d)); } catch { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

// Add: messages[] -> 每条存为带 scope + 结构化元数据(role/seq/timestamp) 的 fact
// 保留 role/顺序/时间, 支撑 AML 多跳/时间/关系维度
// 同步语义 = 全部落盘且可检索后才返回
async function handleAdd(req, res) {
  const body = await readBody(req);
  if (!body) return send(res, 413, { error: "request body too large or invalid" });
  if (!body || !Array.isArray(body.messages)) return send(res, 422, { error: "messages[] required" });
  const { request_id, messages, scope, conversation_id, async_mode } = body;
  if (scope == null) return send(res, 422, { error: "scope required" });
  let stored = 0;
  messages.forEach((m, i) => {
    const content = String(m?.content || "").trim();
    if (!content) return;
    const meta = {
      seq: i, // 保留对话内顺序
    };
    if (m.role != null) meta.role = String(m.role); // 保留 speaker
    if (m.timestamp != null) meta.timestamp = m.timestamp; // 保留原始时间戳
    if (conversation_id != null) meta.conversation_id = String(conversation_id);
    store.add(content, { type: "message", source: "aml", dedupe: false, scope: String(scope), meta });
    stored += 1;
  });
  // request_id 原样回显; 同步模式已完成存储
  return send(res, 200, {
    request_id: request_id ?? null,
    status: "ok",
    stored,
    scope: String(scope),
    conversation_id: conversation_id ?? null,
    async_mode: async_mode || false,
  });
}

async function handleSearch(req, res) {
  const body = await readBody(req);
  if (!body) return send(res, 413, { error: "request body too large or invalid" });
  const query = String(body?.query || "").trim();
  const scope = body?.scope ?? null;
  const top_k = Math.min(Number(body?.top_k || 10), 100);
  if (!query) return send(res, 422, { error: "query required" });
  const hits = store.query(query, { limit: top_k || 10, scope: scope == null ? null : String(scope) });
  return send(res, 200, {
    query,
    scope: scope ?? null,
    count: hits.length,
    results: hits.map((h) => ({ id: h.id, content: h.content, score: Math.round(h.effectiveScore * 100) / 100 })),
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (!authOk(req)) return send(res, 401, { error: "unauthorized" });
  const pathname = url.pathname;
  if (req.method === "POST" && pathname === "/v1/memories/add") return handleAdd(req, res);
  if (req.method === "POST" && pathname === "/v1/memories/search") return handleSearch(req, res);
  if (req.method === "GET" && pathname === "/health") return send(res, 200, { status: "ok" });
  return send(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`[aml-server] listening on :${PORT} | auth=${AUTH_SCHEME} | data=${DATA}`);
  console.log(`  POST /v1/memories/add    POST /v1/memories/search    GET /health`);
});
