#!/usr/bin/env node
// scripts/bench.js - 性能压测 (皮皮虾内核开销, 用 stub LLM 隔离网络)
// 直接调 agent.chat (绕过 HTTP 通道的限流保护, 那是安全特性不是压测目标)
// 覆盖: (1) 并发调用压测 (2) 长会话稳定性 (同一 session 连打 200 轮)
// 输出: p50/p95/p99 延迟 + 失败数 + 长会话每轮耗时
//
// 用法:
//   node scripts/bench.js
//   PPX_BENCH_CONCURRENCY=50 PPX_BENCH_ROUNDS=500 node scripts/bench.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PPXAgent } from "../src/agent/index.js";

const CONCURRENCY = Number(process.env.PPX_BENCH_CONCURRENCY || 20);
const ROUNDS = Number(process.env.PPX_BENCH_ROUNDS || 200);

// stub LLM: 不产生真实网络调用, 压的是皮皮虾自身 (agent/记忆/会话) 开销
function stubLLM() {
  return {
    chat: async () => ({ content: "[stub] 收到。" }),
    streamChat: async (_m, { onDelta } = {}) => { onDelta?.("[stub] 收到。"); return "[stub] 收到。"; },
    apiChat: async () => ({ message: { role: "assistant", content: "[stub] 收到。", tool_calls: null } }),
  };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ppx-bench-"));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "ppx.json"), JSON.stringify({ providers: [] }));

  // v1.0.9: 显式传 dataDir 覆盖 PPX_DATA_DIR 环境变量 — 否则该变量指向生产时, 下方 rmSync 会删除生产数据 (P0)
  const agent = new PPXAgent({ root, dataDir: path.join(root, "data"), globalDataDir: path.join(root, "data") });
  agent.llm = stubLLM();

  console.log(`皮皮虾内核压测 | 并发 ${CONCURRENCY} | 轮次 ${ROUNDS} | stub LLM\n`);

  // (1) 并发压测
  console.log("── (1) 并发调用压测 ──");
  const lat = [];
  let fails = 0;
  const per = Math.ceil(ROUNDS / CONCURRENCY);
  await Promise.all(Array.from({ length: CONCURRENCY }, async (_, i) => {
    for (let r = 0; r < per; r++) {
      const t0 = Date.now();
      try {
        const reply = await agent.chat(`并发#${i} 消息${r}`);
        if (!reply) fails++;
      } catch { fails++; }
      lat.push(Date.now() - t0);
    }
  }));
  lat.sort((a, b) => a - b);
  const pct = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))];
  console.log(`  调用 ${lat.length} | 失败 ${fails} | p50 ${pct(0.5)}ms | p95 ${pct(0.95)}ms | p99 ${pct(0.99)}ms | 最慢 ${lat[lat.length - 1]}ms`);

  // (2) 长会话稳定性
  console.log(`\n── (2) 长会话 ${ROUNDS} 轮 (同一 session) ──`);
  let ok = 0;
  const t0 = Date.now();
  for (let i = 0; i < ROUNDS; i++) {
    try { if (await agent.chat(`长会话第${i}轮`)) ok++; } catch {}
  }
  const ms = Date.now() - t0;
  const sessions = agent.sessionStore.list();
  console.log(`  ${ROUNDS} 轮成功 ${ok} | 耗时 ${(ms / 1000).toFixed(1)}s | ${(ms / ROUNDS).toFixed(1)}ms/轮 | 会话事件 ${sessions.reduce((a, s) => a + (s.count || 0), 0)} 条`);

  agent.shutdown();
  fs.rmSync(agent.dataDir, { recursive: true, force: true });
  console.log("\n=== bench 完成 (失败数 >0 时退出码 1) ===");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("✗ bench 失败:", e.message); process.exit(1); });

