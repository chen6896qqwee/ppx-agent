// scripts/dedupe-facts.js - L1 记忆存量去重 (一次性工具)
// 背景: _normKey() 归一化去重只防新增 (fact-store.add), 存量重复需合并清理
// 逻辑: 按归一化键分组, 每组保留 score+hits 最高的那条, 累加 hits, 移除其余
// 用法: node scripts/dedupe-facts.js [dataDir]   (默认 ./data)
import path from "node:path";
import { FactStore } from "../src/memory/fact-store.js";

const dataDir = path.resolve(process.argv[2] || path.join(process.cwd(), "data"));
const store = new FactStore(dataDir);
const before = store.list();

// 按归一化键分组 (复用 FactStore._normKey, 与 add 去重逻辑同源)
const groups = new Map();
for (const f of before) {
  const key = store._normKey(f.content);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(f);
}

const kept = [];
let removed = 0;
for (const [key, arr] of groups) {
  if (arr.length === 1) { kept.push(arr[0]); continue; }
  // 保留 score+hits 最高; 其余合并进 winner (hits 累加, 时间取最新)
  const winner = [...arr].sort((a, b) => (b.score + b.hits) - (a.score + a.hits))[0];
  const extraHits = arr.filter((f) => f !== winner).reduce((s, f) => s + (f.hits || 0), 0);
  const lastTs = arr.map((f) => f.lastAccess || f.created || "").filter(Boolean).sort().pop();
  if (extraHits) winner.hits = (winner.hits || 0) + extraHits;
  if (lastTs) winner.lastAccess = lastTs;
  kept.push(winner);
  removed += arr.length - 1;
  console.log(`合并 x${arr.length}: "${winner.content.slice(0, 60)}"`);
}

store.facts = kept;
store.rebuildIndex();
store.save();
console.log(`\n去重完成: ${before.length} -> ${kept.length} (移除 ${removed} 条重复)`);
