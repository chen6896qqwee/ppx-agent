// test/legion.test.js - 军团测试
import test from "node:test";
import assert from "node:assert";
import { Legion } from "../src/orchestrator/index.js";

test("军团: 启动多 agent + ping", async () => {
  const legion = new Legion();
  legion.spawnAgent("侦察兵");
  legion.spawnAgent("分析员");
  assert.equal(legion.list().length, 2);
  const r = await legion.send("侦察兵", { type: "ping" });
  assert.equal(r.type, "pong");
  await legion.shutdownAll();
});

test("军团: 并行 broadcast", async () => {
  const legion = new Legion();
  legion.spawnAgent("a1");
  legion.spawnAgent("a2");
  const results = await legion.broadcast("ping", "hi");
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.value?.type === "pong" || r.value?.type === "error"));
  await legion.shutdownAll();
});

test("军团: 角色分工 dispatch", async () => {
  const legion = new Legion();
  legion.spawnAgent("a1");
  legion.spawnAgent("a2");
  const results = await legion.dispatch("chat", ["任务1", "任务2"]);
  assert.equal(results.length, 2);
  assert.ok(results[0].agent && results[1].agent);
  await legion.shutdownAll();
});