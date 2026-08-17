import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { PPXAgent } from "../src/agent/index.js";

function tmp(n){ return fs.mkdtempSync(path.join(os.tmpdir(), `ppx-ans-${n}-`)); }

// ---- 价值对齐 ----
test("价值对齐: 默认 values 注入 system context", () => {
  const agent = new PPXAgent({ root: tmp("va") });
  assert.ok(Array.isArray(agent.config.agent.values), "有默认核心价值数组");
  assert.ok(agent.config.agent.values.length >= 3, "默认价值足够");
  const ctx = agent._context("你好");
  assert.ok(ctx.includes("核心价值"), "system 注入核心价值区");
  assert.ok(ctx.includes("保护用户隐私"), "默认价值文本在 context 里");
  agent.shutdown();
  fs.rmSync(agent.dataDir, { recursive: true, force: true });
});

test("价值对齐: 自定义 values 覆盖默认", () => {
  const root = tmp("va2");
  // 写入自定义 config 覆盖 values
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "ppx.json"), JSON.stringify({ agent: { values: ["永远不泄露密钥"] } }));
  const agent = new PPXAgent({ root });
  assert.deepEqual(agent.config.agent.values, ["永远不泄露密钥"], "自定义 values 生效");
  const ctx = agent._context("x");
  assert.ok(ctx.includes("永远不泄露密钥"));
  assert.ok(!ctx.includes("保护用户隐私"), "默认值被覆盖");
  agent.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

// ---- 自主任务生成 ----
test("主动任务生成: 有待办记忆时返回建议 (无 LLM 走启发式)", async () => {
  const agent = new PPXAgent({ root: tmp("pa") });
  agent.facts.add("记得下周要研究 A 股策略", { importance: 15 });
  const msg = await agent.proactiveSuggest();
  assert.ok(msg, "有待办时返回主动提醒");
  assert.ok(msg.includes("A 股策略"), "提醒包含待办内容");
  agent.shutdown();
  fs.rmSync(agent.dataDir, { recursive: true, force: true });
});

test("主动任务生成: 无待办记忆返回 null", async () => {
  const agent = new PPXAgent({ root: tmp("pb") });
  agent.facts.add("今天天气不错", { importance: 5 });
  const msg = await agent.proactiveSuggest();
  assert.equal(msg, null, "无待办信号不打扰");
  agent.shutdown();
  fs.rmSync(agent.dataDir, { recursive: true, force: true });
});

test("主动任务生成: 定时器默认关闭, 开启后能启停", () => {
  const agent = new PPXAgent({ root: tmp("pc") });
  assert.equal(agent.startProactiveTicker(() => {}), null, "默认 enabled=false 不启动");
  agent.config.agent.proactive = { enabled: true, interval_ms: 60000 };
  const timer = agent.startProactiveTicker(() => {});
  assert.ok(timer, "开启后启动定时器");
  agent.stopProactiveTicker();
  assert.equal(agent._proactiveTimer, null, "可停止");
  agent.shutdown();
  fs.rmSync(agent.dataDir, { recursive: true, force: true });
});

// ---- 生命周期 ----
test("生命周期: born → growing → mature", () => {
  const agent = new PPXAgent({ root: tmp("lc") });
  assert.equal(agent.lifecycle.stage, "born", "构造后 born");
  for (let i = 0; i < 11; i++) agent._lifecycleTick();
  assert.equal(agent.lifecycle.chats, 11, "对话计数");
  assert.equal(agent.lifecycle.stage, "mature", "11 次后 mature");
  const st = agent.lifecycleStatus();
  assert.equal(st.stage, "mature");
  assert.equal(st.chats, 11);
  assert.ok(Array.isArray(st.recent) && st.recent.length >= 2, "阶段日志");
  agent.shutdown();
  fs.rmSync(agent.dataDir, { recursive: true, force: true });
});

test("生命周期: 进化和繁衍计数", () => {
  const agent = new PPXAgent({ root: tmp("lc2") });
  agent.lifecycle.evolved += 1;
  agent.lifecycle.reproduced += 1;
  const st = agent.lifecycleStatus();
  assert.equal(st.evolved, 1);
  assert.equal(st.reproduced, 1);
  agent.shutdown();
  fs.rmSync(agent.dataDir, { recursive: true, force: true });
});
