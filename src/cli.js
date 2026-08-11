#!/usr/bin/env node
// src/cli.js - 皮皮虾 CLI 交互入口
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PPXAgent } from "./agent/index.js";
import { info } from "./utils/logger.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const agent = new PPXAgent({ root: ROOT });

console.log("======================================");
console.log("  皮皮虾 (PPX) - 自我修复·自我学习 Agent");
console.log(`  记忆:${agent.facts.count()}条 | 经验:${agent.experience.lessons.length}条`);
console.log(`  模型: ${agent.llm ? "已配置" : "未配置(离线记忆模式)"}`);
console.log("  输入 quit/exit 退出");
console.log("======================================");

process.stdin.setEncoding("utf8");
process.stdin.on("data", async (d) => {
  const line = d.toString().trim();
  if (!line) return;
  if (["quit", "exit", "q"].includes(line.toLowerCase())) {
    agent.shutdown();
    console.log("皮皮虾 收工, 已保存记忆。");
    process.exit(0);
  }
  const r = await agent.chat(line);
  console.log("\n" + r + "\n");
});
