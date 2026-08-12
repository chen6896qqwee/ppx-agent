import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { PPXAgent } from "../src/agent/index.js";
import { Traces } from "../src/utils/trace.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function tmpRoot(n){ return fs.mkdtempSync(path.join(os.tmpdir(),`ppx-${n}-`)); }

test("可观测: Traces 记录工具调用轨迹", async () => {
  const a = new PPXAgent({ root: tmpRoot("trace") });
  const t = new Traces(a.dataDir);
  t.record({ tool: "get_time", args: {}, result: "2026-08-12", ok: true, durationMs: 5 });
  t.record({ tool: "boom", args: {}, result: "[工具错误] x", ok: false, durationMs: 3 });
  const all = t.read();
  assert.equal(all.length, 2, "两条轨迹已写");
  assert.equal(all[0].tool, "get_time");
  assert.equal(all[0].ok, true);
  assert.equal(all[1].ok, false, "失败轨迹 ok=false");
  assert.ok(all[0].durationMs >= 0);
  a.shutdown();
});

test("可观测: stats 统计失败率", async () => {
  const a = new PPXAgent({ root: tmpRoot("stat") });
  const t = new Traces(a.dataDir);
  t.record({ tool: "a", args: {}, result: "ok", ok: true, durationMs: 10 });
  t.record({ tool: "b", args: {}, result: "ok", ok: true, durationMs: 5 });
  t.record({ tool: "c", args: {}, result: "x", ok: false, durationMs: 2 });
  const s = t.stats();
  assert.equal(s.count, 3);
  assert.equal(s.failed, 1);
  assert.ok(s.failRate.includes("%"));
  a.shutdown();
});

test("LLM摘要: 无LLM时降级为堆叠不崩", async () => {
  const a = new PPXAgent({ root: tmpRoot("sum") });
  a.llm = null; // 强制无 LLM
  const mt = a.memory;
  const big = Array.from({length: 60}, (_,i) => `- [2026-08-12T00:00:00.000Z] 用户: 测试消息${i} 内容`);
  fs.writeFileSync(mt.todayMd, "# 2026-08-12\n" + big.join("\n") + "\n", "utf8");
  await mt._compactIfNeeded();
  const longterm = fs.readFileSync(mt.longtermMd, "utf8");
  assert.ok(longterm.includes("thin") || longterm.includes("archived"), "无LLM应降级堆叠: " + longterm.slice(-80));
  a.shutdown();
});
