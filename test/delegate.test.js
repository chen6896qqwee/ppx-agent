import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { PPXAgent } from "../src/agent/index.js";
import { buildArbitrationInput, arbitrate } from "../src/tools/delegate.js";

function tmp(n){ return fs.mkdtempSync(path.join(os.tmpdir(), `ppx-dl-${n}-`)); }

test("spawn_agent 工具已注册", () => {
  const agent = new PPXAgent({ root: tmp("reg") });
  assert.ok(agent.tools.has("spawn_agent"), "spawn_agent 工具已注册");
  const meta = agent.tools.tools.get("spawn_agent");
  assert.ok(meta.parameters.properties.task, "有 task 参数");
  assert.ok(meta.parameters.properties.role, "有 role 参数");
  assert.ok(meta.parameters.properties.tasks, "有 tasks 参数");
  assert.ok(meta.parameters.properties.perspectives, "有 perspectives 参数");
  assert.ok(meta.parameters.properties.arbitrate, "有 arbitrate 参数");
  assert.ok(meta.parameters.properties.judge, "有 judge 参数");
  agent.shutdown();
});

test("spawn_agent 无 LLM 时返回引导错误 (不崩)", async () => {
  const agent = new PPXAgent({ root: tmp("nolm") });
  const res = await agent.tools.call("spawn_agent", { task: "x" }, { agent });
  assert.ok(res.includes("未配置模型"), "无 LLM 时明确引导");
  agent.shutdown();
  fs.rmSync(agent.dataDir, { recursive: true, force: true });
});

test("spawn_agent 无 agent 上下文时返回错误 (不崩)", async () => {
  const agent = new PPXAgent({ root: tmp("noctx") });
  const res = await agent.tools.call("spawn_agent", { task: "x" });
  assert.ok(res.includes("无 agent 上下文") || res.includes("工具错误"), "缺上下文时安全失败");
  agent.shutdown();
  fs.rmSync(agent.dataDir, { recursive: true, force: true });
});

test("spawn_agent 无 task 也无 tasks 时返回引导错误", async () => {
  const agent = new PPXAgent({ root: tmp("notask") });
  const res = await agent.tools.call("spawn_agent", {}, { agent });
  assert.ok(res.includes("需要 task 或 tasks"), `应引导补 task, 实际: ${res}`);
  agent.shutdown();
  fs.rmSync(agent.dataDir, { recursive: true, force: true });
});

// --- 仲裁/差异化上下文纯函数 ---

test("buildArbitrationInput 组装多子结果含视角", () => {
  const input = buildArbitrationInput(
    ["分析代码质量", "分析性能"],
    ["质量一般", "性能优秀"],
    ["质量视角", "性能视角"]
  );
  assert.ok(input.includes("【子任务1 (视角: 质量视角)】"), "含视角标注");
  assert.ok(input.includes("【结果2】性能优秀"), "含第二结果");
});

test("arbitrate 有 LLM 时返回仲裁结果", async () => {
  const fakeAgent = { llm: { chat: async () => ({ content: "综合结论: 质量一般, 性能优秀" }) } };
  const out = await arbitrate(fakeAgent, ["任务A", "任务B"], ["结果A", "结果B"], [], "");
  assert.equal(out, "综合结论: 质量一般, 性能优秀");
});

test("arbitrate 无 LLM 或失败时降级拼接 (不崩)", async () => {
  const noLlm = await arbitrate({}, ["任务A"], ["结果A"], [], "");
  assert.ok(noLlm.includes("结果A"), "无 LLM 降级拼接");
  const failAgent = { llm: { chat: async () => { throw new Error("boom"); } } };
  const failed = await arbitrate(failAgent, ["任务A"], ["结果A"], [], "");
  assert.ok(failed.includes("结果A"), "LLM 失败降级拼接");
});

test("spawn_agent 多任务不仲裁时拼接各方结果 (mock legion)", async () => {
  const agent = new PPXAgent({ root: tmp("multi") });
  agent.llm = { chat: async () => ({ content: "x" }) }; // 占位, 满足"已配置模型"
  // 注入 mock legion, 不真 spawn 子进程
  const replies = ["质量一般", "性能优秀"];
  agent._legion = {
    spawnAgent: () => {},
    send: async () => ({ reply: replies.shift() }),
  };
  const res = await agent.tools.call("spawn_agent", {
    tasks: ["分析代码质量", "分析性能"],
    perspectives: ["质量视角", "性能视角"],
  }, { agent });
  assert.ok(res.includes("【子任务1") && res.includes("【子任务2"), "多任务结果拼接");
  assert.ok(res.includes("质量一般") && res.includes("性能优秀"), "含各方结果");
  agent.shutdown();
  fs.rmSync(agent.dataDir, { recursive: true, force: true });
});

test("spawn_agent 多任务仲裁时走主 agent 聚合", async () => {
  const agent = new PPXAgent({ root: tmp("arb") });
  agent.llm = {
    chat: async () => ({ content: "仲裁结论: 取性能方案" }),
  };
  const replies = ["方案A", "方案B"];
  agent._legion = {
    spawnAgent: () => {},
    send: async () => ({ reply: replies.shift() }),
  };
  const res = await agent.tools.call("spawn_agent", {
    tasks: ["方案A评估", "方案B评估"],
    arbitrate: true,
    judge: "选出最优",
  }, { agent });
  assert.ok(res.includes("仲裁结论: 取性能方案"), `仲裁生效, 实际: ${res}`);
  agent.shutdown();
  fs.rmSync(agent.dataDir, { recursive: true, force: true });
});

test("spawn_agent 单任务保持旧行为 (直接返回子 agent 回复)", async () => {
  const agent = new PPXAgent({ root: tmp("single") });
  agent.llm = { chat: async () => ({ content: "x" }) };
  agent._legion = {
    spawnAgent: () => {},
    send: async () => ({ reply: "单子任务回复" }),
  };
  const res = await agent.tools.call("spawn_agent", { task: "干活", role: "worker" }, { agent });
  assert.equal(res, "单子任务回复");
  agent.shutdown();
  fs.rmSync(agent.dataDir, { recursive: true, force: true });
});

test("spawn_agent 多任务超时返回失败标注 (不崩)", async () => {
  const agent = new PPXAgent({ root: tmp("timeout") });
  agent.llm = { chat: async () => ({ content: "x" }) };
  agent._legion = {
    spawnAgent: () => {},
    send: async () => new Promise((_, rej) => setTimeout(() => rej(new Error("agent 已退出")), 10)),
  };
  const res = await agent.tools.call("spawn_agent", {
    tasks: ["任务A", "任务B"],
  }, { agent });
  assert.ok(res.includes("任务A失败") || res.includes("子任务"), `超时标注, 实际: ${res}`);
  agent.shutdown();
  fs.rmSync(agent.dataDir, { recursive: true, force: true });
});

test("差异化视角注入 system prompt (_perspective)", () => {
  const agent = new PPXAgent({ root: tmp("persp") });
  try {
    const plain = agent._context("普通问题");
    assert.ok(!plain.includes("任务视角"), "无视角时不含注入");
    agent._perspective = "从代码质量角度";
    const withP = agent._context("普通问题");
    assert.ok(withP.includes("【任务视角】从代码质量角度"), `注入差异化视角, 实际: ${withP.slice(0, 300)}`);
  } finally {
    agent.shutdown();
    fs.rmSync(agent.dataDir, { recursive: true, force: true });
  }
});
