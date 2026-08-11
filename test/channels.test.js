// test/channels.test.js - 通道测试
import test from "node:test";
import assert from "node:assert";
import { startServer } from "../src/server.js";

test("HTTP 通道: 启动 + /health", async () => {
  const { server } = await startServer({ root: process.cwd(), port: 8911, host: "127.0.0.1" });
  const r = await fetch("http://127.0.0.1:8911/health");
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.status, "ok");
  await new Promise((res) => server.close(res));
});

test("HTTP 通道: POST /message 对话", async () => {
  const { server, agent } = await startServer({ root: process.cwd(), port: 8912, host: "127.0.0.1" });
  const r = await fetch("http://127.0.0.1:8912/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "你好皮皮虾" }),
  });
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.ok(data.reply && data.reply.length > 0, "有回复");
  agent.shutdown();
  await new Promise((res) => server.close(res));
});

test("HTTP 通道: 缺 message 返回 400", async () => {
  const { server } = await startServer({ root: process.cwd(), port: 8913, host: "127.0.0.1" });
  const r = await fetch("http://127.0.0.1:8913/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 400);
  await new Promise((res) => server.close(res));
});