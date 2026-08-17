import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { PPXAgent } from "../src/agent/index.js";

function tmp(n){ return fs.mkdtempSync(path.join(os.tmpdir(), `ppx-dl-${n}-`)); }

test("spawn_agent 工具已注册", () => {
  const agent = new PPXAgent({ root: tmp("reg") });
  assert.ok(agent.tools.has("spawn_agent"), "spawn_agent 工具已注册");
  const meta = agent.tools.tools.get("spawn_agent");
  assert.ok(meta.parameters.properties.task, "有 task 参数");
  assert.ok(meta.parameters.properties.role, "有 role 参数");
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
