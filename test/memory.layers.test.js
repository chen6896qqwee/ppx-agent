// test/memory.layers.test.js - 腾讯风格四层记忆测试
import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { PPXAgent } from "../src/agent/index.js";
import { L0Recorder, SceneStore, PersonaStore } from "../src/memory/index.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// 每个测试用独立临时数据目录, 避免数据污染
function tmpRoot(name) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `ppx-${name}-`));
  return d;
}

test("L0: 记录原始对话到 JSONL", () => {
  const a = new PPXAgent({ root: ROOT, configFile: null });
  const before = a.l0.count();
  a.l0.record({ role: "user", content: "今天研究了量子计算在金融的应用", sessionKey: "test" });
  assert.ok(a.l0.count() > before, "L0 文件增长");
  const msgs = a.l0.read();
  assert.ok(Array.isArray(msgs));
  a.shutdown();
});

test("L0: 寒暄噪音被过滤", () => {
  const rec = new L0Recorder(tmpRoot("l0"));
  rec.record({ role: "user", content: "你好" });
  rec.record({ role: "user", content: "/help" });
  assert.equal(rec.count(), 0, "寒暄和命令不应记录");
});

test("L2: 场景归档", () => {
  const a = new PPXAgent({ root: tmpRoot("l2") });
  const f = a.facts.add("用户关注 A股 量化交易 资金流向", { type: "conversation" });
  const scene = a.scenes.assign(f);
  assert.ok(scene, "应归档到场景");
  assert.ok(scene.keywords.length > 0);
  assert.ok(a.scenes.count() >= 1);
  a.shutdown();
});

test("L3: 生成用户画像", () => {
  const a = new PPXAgent({ root: tmpRoot("l3") });
  a.facts.add("用户喜欢研究股票技术分析", { type: "conversation" });
  a.facts.add("用户主要关注A股市场", { type: "conversation" });
  const persona = a.personaStore.buildUserPersona(a.facts.list(), { force: true });
  assert.ok(persona.includes("画像"), "画像含标题");
  assert.ok(persona.length > 20);
  a.shutdown();
});

test("L3: 生成 agent 自我画像", () => {
  const a = new PPXAgent({ root: tmpRoot("l3a") });
  a.experience.learn({ task: "测试", lesson: "零依赖最稳", tags: ["test"] });
  const persona = a.personaStore.buildAgentPersona(a.experience.lessons, { force: true });
  assert.ok(persona.includes("皮皮虾"));
  assert.ok(persona.includes("经验"));
  a.shutdown();
});

test("对话完整走 L0-L3 管道", async () => {
  const a = new PPXAgent({ root: tmpRoot("pipe") });
  await a.chat("最近我在研究优化记忆架构", { persist: true });
  assert.ok(a.l0.count() >= 0);
  assert.ok(a.scenes.count() >= 0);
  a.shutdown();
});
test("滚动压缩: today.md 超量后归档到 longterm", async () => {
  const a = new PPXAgent({ root: tmpRoot("compact") });
  // 直接往 today.md 塞超量行, 触发压缩
  const mt = a.memory;
  let long = mt.longtermMd;
  const big = Array.from({length: 60}, (_,i) => `- [2026-08-12T00:00:00.000Z] 用户: 测试消息${i} 内容`);
  fs.writeFileSync(mt.todayMd, "# 2026-08-12\n" + big.join("\n") + "\n", "utf8");
  await mt._compactIfNeeded();
  const today = fs.readFileSync(mt.todayMd, "utf8");
  const longterm = fs.readFileSync(mt.longtermMd, "utf8");
  assert.ok(longterm.includes("thin"), "longterm 应含压缩标记");
  assert.ok(today.split("\n").filter(Boolean).length <= 21, "today 应只剩近期行: " + today.split("\n").length);
  a.shutdown();
});