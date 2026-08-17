// src/tools/delegate.js - 多 agent 自主协作工具 (spawn_agent)
// 让 agent 在工具循环里自主决定 spawn 子 agent 分工 (ANS 神经元中枢的最小实现):
//   - 主 agent 分析任务 → 认为需要专门角色/并行/隔离 → 调 spawn_agent
//   - 子 agent: 独立会话目录 (隔离) + 共享全局经验库 (ANS 全局记忆)
//   - 子 agent 复用懒建军团 (agent._legion), 不重复 spawn 进程
import path from "node:path";
import { Legion } from "../orchestrator/legion.js";

const DELEGATE_TIMEOUT_MS = 120000; // 子任务最长等待 (防卡死主 agent 工具循环)

export function registerDelegateTools(catalog, _opts = {}) {
  catalog.register({
    name: "spawn_agent",
    description: "派生子 agent 处理子任务并等待结果。适合需要专门角色、并行、或隔离执行的任务 (如数据分析、代码审查、多角度论证)。子 agent 共享全局经验库。",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "要交给子 agent 的任务描述 (清晰完整, 含上下文)" },
        role: { type: "string", description: "子 agent 角色名 (如 数据分析师/代码审查员), 默认 helper" },
      },
      required: ["task"],
    },
    execute: async (args, ctx) => {
      const agent = ctx?.agent;
      if (!agent) return "[工具错误] spawn_agent: 无 agent 上下文";
      if (!agent.llm) return "[工具错误] spawn_agent: 主 agent 未配置模型, 无法委派";
      // 懒建军团 (复用已有, 避免重复 spawn 进程)
      let L = agent._legion;
      if (!L) { L = new Legion(); agent._legion = L; }
      const role = String(args.role || "helper").replace(/[^\w-]/g, "_").slice(0, 24);
      const name = `${role}_${Date.now().toString(36)}`;
      try {
        // 子 agent: 独立会话目录 (隔离) + 共享全局经验库
        L.spawnAgent(name, {
          dataDir: path.join(agent.dataDir, "legion", name),
          globalDataDir: agent.globalDataDir,
        });
        // 生命周期: 繁衍计数 (ANS: reproducing)
        if (agent.lifecycle) agent.lifecycle.reproduced += 1;
        const reply = await Promise.race([
          L.send(name, { type: "chat", message: String(args.task).slice(0, 4000) }),
          new Promise((_, rej) => setTimeout(() => rej(new Error(`子任务超时 (${DELEGATE_TIMEOUT_MS / 1000}s)`)), DELEGATE_TIMEOUT_MS)),
        ]);
        return reply.reply || "(子 agent 无回复)";
      } catch (e) {
        return `[工具错误] spawn_agent: ${e.message}`;
      }
    },
  });
}
