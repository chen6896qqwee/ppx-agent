import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { Experience } from "../src/memory/experience.js";
import { withFileLock, readJson, writeJson } from "../src/utils/store.js";
import { PPXAgent } from "../src/agent/index.js";

function tmp(n){ return fs.mkdtempSync(path.join(os.tmpdir(), `ppx-gm-${n}-`)); }

test("withFileLock: 临界区读-改-写不丢数据", () => {
  const dir = tmp("lock");
  const file = path.join(dir, "count.json");
  for (let i = 0; i < 10; i++) {
    withFileLock(file, () => {
      const cur = readJson(file, 0);
      writeJson(file, cur + 1);
    });
  }
  assert.equal(readJson(file, 0), 10, "10 次锁内读改写不丢");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("withFileLock: 异常时锁被释放 (finally)", () => {
  const dir = tmp("lock2");
  const file = path.join(dir, "x.json");
  assert.throws(() => {
    withFileLock(file, () => { throw new Error("boom"); });
  }, /boom/);
  // 锁应已释放, 能再次获取并执行
  let ran = false;
  withFileLock(file, () => { ran = true; });
  assert.equal(ran, true, "锁已释放可复用");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("经验库跨实例共享: 多实例交替 learn 不丢条目", () => {
  const dir = tmp("exp");
  const mk = () => new Experience(dir);
  for (let i = 0; i < 5; i++) {
    mk().learn({ task: "t", outcome: "o", lesson: `A 经验教训 ${i}` });
    mk().learn({ task: "t", outcome: "o", lesson: `B 经验教训 ${i}` });
  }
  const exp = new Experience(dir);
  assert.equal(exp.lessons.length, 10, "10 条经验全保留 (锁内重读+写回, 无并发覆盖丢失)");
  assert.ok(exp.recall("A 经验教训 0").length >= 1, "能召回已共享的经验");
  assert.ok(exp.recall("B 经验教训 4").length >= 1, "最后写入的经验也可召回");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("PPXAgent globalDataDir: 经验库走全局目录", () => {
  const root = tmp("root");
  const global = tmp("global");
  const a = new PPXAgent({ root, globalDataDir: global });
  assert.ok(a.experience, "agent 有经验库");
  assert.ok(a.experience.dir.includes(global), "经验库在全局目录");
  assert.ok(!a.experience.dir.includes(path.join(root, "data")), "不在本地 dataDir");
  a.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(global, { recursive: true, force: true });
});

test("PPXAgent 默认: globalDataDir 回退到 dataDir (行为不变)", () => {
  const root = tmp("default");
  const a = new PPXAgent({ root });
  assert.equal(a.globalDataDir, a.dataDir, "未指定时全局=本地 (向后兼容)");
  a.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});
