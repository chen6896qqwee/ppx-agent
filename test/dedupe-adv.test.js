// test/dedupe-adv.test.js - 高级去重: 经验库内容去重 + 记忆语义去重 (bigram Jaccard)
import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { PPXAgent } from "../src/agent/index.js";
import { FactStore } from "../src/memory/fact-store.js";

function tmpRoot(n) { return fs.mkdtempSync(path.join(os.tmpdir(), `ppx-dd-${n}-`)); }

// ---- 经验库内容去重 ----
test("Experience.learn: 相同 lesson 重复学命中加分而非新增", () => {
  const a = new PPXAgent({ root: tmpRoot("exp") });
  const r1 = a.experience.learn({ task: "t1", lesson: "测试经验：多进程要加锁" });
  const r2 = a.experience.learn({ task: "t2", lesson: "测试经验：多进程要加锁" }); // 相同 lesson
  assert.equal(a.experience.lessons.length, 1, "相同 lesson 只存 1 条");
  assert.equal(r1.id, r2.id, "返回同一条 (命中加分)");
  assert.equal(r2.uses, 1, "uses 累加");
  a.shutdown();
  fs.rmSync(a.dataDir, { recursive: true, force: true });
});

test("Experience.learn: 不同 lesson 正常新增", () => {
  const a = new PPXAgent({ root: tmpRoot("exp2") });
  a.experience.learn({ lesson: "经验A：使用临时目录隔离测试" });
  a.experience.learn({ lesson: "经验B：工具超时要设上限" });
  assert.equal(a.experience.lessons.length, 2, "不同 lesson 各存 1 条");
  a.shutdown();
  fs.rmSync(a.dataDir, { recursive: true, force: true });
});

// ---- 记忆语义去重 (bigram Jaccard) ----
test("FactStore._jaccard: 同义变体相似度高, 无关内容相似度低", () => {
  const a = new PPXAgent({ root: tmpRoot("jac") });
  const sim = a.facts._jaccard(
    "一个完整的任务必须包含三件套：目标（干什么）、涉及的资源（文件、服务、数据）和验收标准（做完什么样算完）",
    "一个完整的任务必须包含目标（干什么）、涉及的资源（文件、服务、数据）和验收标准（做完什么样算完）这三件套"
  );
  assert.ok(sim > 0.7, `同义变体相似度应高, 实际 ${sim}`);
  const low = a.facts._jaccard("今天天气不错", "股票策略下周建仓");
  assert.ok(low < 0.3, `无关内容相似度应低, 实际 ${low}`);
  a.shutdown();
  fs.rmSync(a.dataDir, { recursive: true, force: true });
});

test("FactStore.findSimilar: 语义相似的现有事实可被找到", () => {
  const a = new PPXAgent({ root: tmpRoot("fs") });
  a.facts.add("一个完整的任务必须包含三件套：目标（干什么）、涉及的资源（文件、服务、数据）和验收标准（做完什么样算完）", { source: "manual" });
  // 同义变体 (三件套位置不同), 真实相似度 ~0.9
  const found = a.facts.findSimilar("一个完整的任务必须包含目标（干什么）、涉及的资源（文件、服务、数据）和验收标准（做完什么样算完）这三件套");
  assert.ok(found, "应找到语义相似的事实");
  a.shutdown();
  fs.rmSync(a.dataDir, { recursive: true, force: true });
});

test("FactStore.add(similarThreshold): 同义变体命中加分而非新增", () => {
  const a = new PPXAgent({ root: tmpRoot("addsim") });
  a.facts.add("一个完整的任务必须包含三件套：目标（干什么）、涉及的资源（文件、服务、数据）和验收标准（做完什么样算完）", { source: "manual" });
  const before = a.facts.count();
  a.facts.add("一个完整的任务必须包含目标（干什么）、涉及的资源（文件、服务、数据）和验收标准（做完什么样算完）这三件套", { source: "extract", similarThreshold: 0.6 });
  assert.equal(a.facts.count(), before, "同义变体不新增");
  const all = a.facts.list();
  assert.equal(all.length, 1, "仍只有 1 条");
  assert.ok(all[0].hits >= 1, "hits 加分");
  a.shutdown();
  fs.rmSync(a.dataDir, { recursive: true, force: true });
});

test("FactStore.add(similarThreshold=0): 不启用语义去重 (向后兼容)", () => {
  const a = new PPXAgent({ root: tmpRoot("addnosim") });
  a.facts.add("任务三件套：目标、资源、验收标准", { source: "manual" });
  const before = a.facts.count();
  // 默认不加 similarThreshold -> 字面不同则新增
  a.facts.add("任务三件套：目标、资源、验收标准，一条都不能少", { source: "manual" });
  assert.equal(a.facts.count(), before + 1, "默认不语义去重, 新增");
  a.shutdown();
  fs.rmSync(a.dataDir, { recursive: true, force: true });
});

// ---- L3 画像展示前去重 ----
test("L3 buildAgentPersona: 重复经验在画像中只展示一次", () => {
  const a = new PPXAgent({ root: tmpRoot("l3dd") });
  a.experience.learn({ lesson: "零依赖比第三方依赖更稳" });
  a.experience.learn({ lesson: "零依赖比第三方依赖更稳" });
  a.experience.learn({ lesson: "零依赖比第三方依赖更稳" });
  const persona = a.personaStore.buildAgentPersona(a.experience.lessons, { force: true });
  const count = (persona.match(/零依赖比第三方依赖更稳/g) || []).length;
  assert.equal(count, 1, "重复经验只展示一次");
  a.shutdown();
  fs.rmSync(a.dataDir, { recursive: true, force: true });
});

test("L3 buildUserPersona: 完全重复记忆在画像中去重", () => {
  const a = new PPXAgent({ root: tmpRoot("l3ud") });
  a.facts.add("任务必须包含目标、资源、验收标准三件套", { source: "extract" });
  a.facts.add("任务必须包含目标、资源、验收标准三件套", { source: "extract" });
  const persona = a.personaStore.buildUserPersona(a.facts.list(), { force: true });
  // 精确去重: 完全相同的重复在画像中只出现一次
  const count = (persona.match(/任务必须包含目标、资源、验收标准三件套/g) || []).length;
  assert.equal(count, 1, "完全重复记忆只展示一次");
  a.shutdown();
  fs.rmSync(a.dataDir, { recursive: true, force: true });
});

// ---- FactStore 工具函数直接可用 ----
test("FactStore 导出 _jaccard / findSimilar 纯函数可测", () => {
  const a = new PPXAgent({ root: tmpRoot("util") });
  assert.equal(typeof a.facts._jaccard, "function");
  assert.equal(typeof a.facts.findSimilar, "function");
  a.shutdown();
  fs.rmSync(a.dataDir, { recursive: true, force: true });
});
