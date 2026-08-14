// test/channels.test.js - 通道测试
// 动态端口(0) + 读取自动生成的鉴权 token, 避免端口冲突与 401
import test from "node:test";
import assert from "node:assert";
import { startServer } from "../src/server.js";

function stubLLM() {
  return {
    chat: async () => ({ content: "[stub] 你好, 兄弟!" }),
    streamChat: async (_m, { onDelta } = {}) => { onDelta && onDelta("[stub] 你好, 兄弟!"); return "[stub] 你好, 兄弟!"; },
    apiChat: async () => ({ message: { role: "assistant", content: "[stub] 你好, 兄弟!", tool_calls: null } }),
  };
}

async function boot(opts = {}) {
  const svc = await startServer({ root: process.cwd(), port: 0, host: "127.0.0.1", ...opts });
  const port = svc.server.address().port;
  const token = svc.http.authToken; // 自动生成的鉴权 token
  const headers = token ? { "Content-Type": "application/json", "Authorization": `Bearer ${token}` } : { "Content-Type": "application/json" };
  return { ...svc, port, headers };
}

test("HTTP 通道: 启动 + /health", async () => {
  const { server, port } = await boot();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    const data = await r.json();
    assert.equal(r.status, 200);
    assert.equal(data.status, "ok");
  } finally {
    await new Promise((res) => server.close(res));
  }
});

test("HTTP 通道: POST /message 对话", async () => {
  const { server, agent, port, headers } = await boot({ llm: stubLLM() });
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
  }
});

test("HTTP 通道: 缺 message 返回 400", async () => {
  const { server, agent, port, headers } = await boot();
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
  }
});
