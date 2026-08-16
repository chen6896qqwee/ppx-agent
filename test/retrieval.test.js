// test/retrieval.test.js - 检索质量回归 (BM25 + bigram 精排)
// 固化 benchmark: 老版 Jaccard/长段分词 在这些查询上必挂, 本测试防回退
import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { FactStore } from "../src/memory/fact-store.js";

function seed() {
  const f = new FactStore(fs.mkdtempSync(path.join(os.tmpdir(), "ppx-retr-")));
  f.add("皮皮虾是零依赖纯Node的智能体内核，护城河是四层记忆加自愈", { source: "t" });
  f.add("兄弟主要做A股量化交易，关注资金流驱动的短线策略", { source: "t" });
  f.add("止损规则是亏损5%就无条件清仓，连续亏损2次暂停交易", { source: "t" });
  f.add("不做科创板688和ST股票，只做主板加创业板", { source: "t" });
  f.add("华泰柏瑞杯模拟交易比赛第二轮，2026年7月21日开始", { source: "t" });
  f.add("当前持仓国际复材，发现创业板违规已经修复排除规则", { source: "t" });
  return f;
}

test("检索: BM25+bigram 命中相关事实 (老版必挂项)", () => {
  const f = seed();
  const cases = [
    ["止损 清仓", "止损"],      // 长段分词老版必挂
    ["量化 资金流", "量化"],    // 术语重叠, 老版易错
    ["模拟交易 比赛", "模拟交易"],
    ["科创板 ST", "科创板"],
    ["零依赖 内核", "零依赖"],
    ["持仓 国际复材", "国际复材"],
  ];
  for (const [q, exp] of cases) {
    const r = f.query(q, { limit: 1 });
    assert.ok(r.length >= 1, `"${q}" 应有结果`);
    assert.ok(r[0].content.includes(exp), `"${q}" 应命中 "${exp}", 实际: ${r[0].content.slice(0, 30)}`);
  }
});

test("检索: 空查询返回全部 (按衰减分)", () => {
  const f = seed();
  const r = f.query("", { limit: 10 });
  assert.equal(r.length, f.count(), "空查询应返回全部");
});

test("检索: 无匹配查询返回空 (过滤噪声)", () => {
  const f = seed();
  const r = f.query("飞书 沟通", { limit: 5 });
  assert.equal(r.length, 0, "无交集应返回空, 不塞无关结果");
});

test("检索: 相关优先于弱相关 (排序正确)", () => {
  const f = seed();
  const r = f.query("止损 清仓", { limit: 5 });
  assert.ok(r[0].content.includes("止损"), "止损相关应排最前");
});

test("检索: 英文+数字 token 命中", () => {
  const f = seed();
  const r = f.query("ST 688", { limit: 3 });
  assert.ok(r.some((x) => x.content.includes("ST")), "应命中 ST 记忆");
});

test("检索: scope 隔离 (AML 契约, 防回退)", () => {
  const f = seed();
  f.add("兄弟做A股量化交易", { source: "t", scope: "sA" });
  f.add("散户只关注资金流不看量化", { source: "t", scope: "sB" });
  // sA 查询"量化": 命中自己的, 不混 sB
  const a = f.query("量化 交易", { limit: 5, scope: "sA" });
  assert.ok(a.some((x) => x.content.includes("A股量化")), "sA 命中自己的数据");
  assert.ok(!a.some((x) => x.content.includes("散户")), "sA 不混入 sB");
  // sB 查询"资金流": 命中自己的, 不混 sA
  const b = f.query("资金流", { limit: 5, scope: "sB" });
  assert.ok(b.some((x) => x.content.includes("散户")), "sB 命中自己的数据");
  assert.ok(!b.some((x) => x.content.includes("A股量化")), "sB 不混入 sA");
});
