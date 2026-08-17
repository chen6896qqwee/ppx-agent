// test/channels.test.js - 通道测试
// 动态端口(0) + 读取自动生成的鉴权 token, 避免端口冲突与 401
// P0 测试隔离: boot 用 tmp 根目录, 绝不写生产 data/ (防止 stub LLM 污染真实会话/记忆)
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "../src/server.js";

function stubLLM() {
  return {
    chat: async () => ({ content: "[stub] 你好, 兄弟!" }),
    streamChat: async (_m, { onDelta } = {}) => { onDelta && onDelta("[stub] 你好, 兄弟!"); return "[stub] 你好, 兄弟!"; },
    apiChat: async () => ({ message: { role: "assistant", content: "[stub] 你好, 兄弟!", tool_calls: null } }),
  };
}

async function boot(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ppx-ch-"));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "ppx.json"), JSON.stringify({ providers: [] }));
  const svc = await startServer({ root, port: 0, host: "127.0.0.1", ...opts });
  const port = svc.server.address().port;
  const token = svc.http.authToken; // 自动生成的鉴权 token
  const headers = token ? { "Content-Type": "application/json", "Authorization": `Bearer ${token}` } : { "Content-Type": "application/json" };
  return { ...svc, port, headers, root };
}

// 统一清理: agent + server 由调用方 close, 这里只删 tmp 根
function cleanup(svc) {
  if (!svc) return;
  if (svc.root) { try { fs.rmSync(svc.root, { recursive: true, force: true }); } catch {} }
}

test("HTTP 通道: 启动 + /health", async () => {
  const svc = await boot();
  const { server, port } = svc;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    const data = await r.json();
    assert.equal(r.status, 200);
    assert.equal(data.status, "ok");
  } finally {
    await new Promise((res) => server.close(res));
    cleanup(svc);
  }
});

test("HTTP 通道: POST /message 对话", async () => {
  const svc = await boot({ llm: stubLLM() });
  const { server, agent, port, headers } = svc;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "你好皮皮虾" }),
    });
    const data = await r.json();
    assert.equal(r.status, 200);
    assert.ok(data.reply && data.reply.length > 0, "有回复");
  } finally {
    agent.shutdown();
    await new Promise((res) => server.close(res));
    cleanup(svc);
  }
});

test("HTTP 通道: 缺 message 返回 400", async () => {
  const svc = await boot();
  const { server, agent, port, headers } = svc;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 400);
  } finally {
    agent.shutdown();
    await new Promise((res) => server.close(res));
    cleanup(svc);
  }
});
