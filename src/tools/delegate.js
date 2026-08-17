// src/tools/delegate.js - 多 agent 自主协作工具 (spawn_agent)
// 让 agent 在工具循环里自主决定 spawn 子 agent 分工 (ANS 神经元中枢的最小实现):
//   - 主 agent 分析任务 → 认为需要专门角色/并行/隔离 → 调 spawn_agent
//   - 子 agent: 独立会话目录 (隔离) + 共享全局经验库 (ANS 全局记忆)
//   - 子 agent 复用懒建军团 (agent._legion), 不重复 spawn 进程
// v2 (2026-08-17): 吸收 Anthropic 多智能体研究洞察
//   - 并行任务: tasks 数组并行派发多个子 agent (专才 + 并行化)
//   - 差异化上下文: perspectives 注入每个子 agent 专属视角, 对抗同质失败
//   - 仲裁聚合: arbitrate 时主 agent LLM 综合各子结果做最终裁决
import path from "node:path";
import { Legion } from "../orchestrator/legion.js";

const DELEGATE_TIMEOUT_MS = 120000; // 子任务最长等待 (防卡死主 agent 工具循环)

// 纯函数: 把多个子任务 + 结果 + 视角整理成给仲裁 LLM 的输入
export function buildArbitrationInput(tasks, results, perspectives) {
  return tasks.map((t, i) => {
    const p = perspectives?.[i] ? ` (视角: ${perspectives[i]})` : "";
    return `【子任务${i + 1}${p}】${t}\n【结果${i + 1}】${String(results[i] || "").slice(0, 2000)}`;
  }).join("\n\n");
}

// 主 agent 聚合评审 (仲裁者模式): 综合各子结果, 输出最终裁决
// 无 LLM 或评审失败时退化为简单拼接 (不阻塞)
export async function arbitrate(agent, tasks, results, perspectives, judge) {
  const input = buildArbitrationInput(tasks, results, perspectives);
  const system = "你是多 agent 结果的仲裁者。综合各方结果, 识别分歧与共识, 给出一个整合后的最终答案。直接输出最终答案, 不要复述过程。";
  const user = input + (judge ? `\n\n【评审要求】${judge}` : "");
  try {
    const r = await agent.llm.chat([
      { role: "system", content: system },
      { role: "user", content: user.slice(0, 6000) },
    ]);
    const text = String(r?.content || "").trim();
    return text || `(仲裁无输出)\n\n${input}`;
  } catch (e) {
    return `(仲裁失败, 直出各方结果)\n\n${input}`;
  }
}

export function registerDelegateTools(catalog, _opts = {}) {
  catalog.register({
    name: "spawn_agent",
    description: "派生子 agent 处理子任务并等待结果。适合需要专门角色、并行、或隔离执行的任务 (如数据分析、代码审查、多角度论证)。子 agent 共享全局经验库。支持: 单个 task; 或 tasks 数组并行派发多个子 agent + perspectives 差异化视角; arbitrate=true 时主 agent 仲裁聚合各方结果。",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "单个子任务描述 (清晰完整, 含上下文); 与 tasks 二选一" },
        tasks: { type: "array", items: { type: "string" }, description: "并行子任务列表 (每个子 agent 一个), 适合多角度论证/并行处理; 与 task 二选一" },
        perspectives: { type: "array", items: { type: "string" }, description: "差异化视角列表, 与 tasks 一一对应, 注入每个子 agent 专属视角 (对抗同质失败), 可缺省" },
        role: { type: "string", description: "子 agent 角色名 (如 数据分析师/代码审查员), 默认 helper" },
        arbitrate: { type: "boolean", description: "是否由主 agent 仲裁聚合所有子结果 (并行任务时推荐), 默认 false 直接返回拼接结果" },
        judge: { type: "string", description: "仲裁评审指令 (arbitrate=true 时生效, 如 找出最可靠结论/合并去重), 可缺省" },
      },
    },
    execute: async (args, ctx) => {
      const agent = ctx?.agent;
      if (!agent) return "[工具错误] spawn_agent: 无 agent 上下文";
      // 先校验参数, 再校验环境 (输入校验优先)
      let tasks = null;
      if (Array.isArray(args.tasks) && args.tasks.length) {
        tasks = args.tasks.map((t) => String(t).slice(0, 4000));
      } else if (args.task) {
        tasks = [String(args.task).slice(0, 4000)];
      }
      if (!tasks) return "[工具错误] spawn_agent: 需要 task 或 tasks";
      if (!agent.llm) return "[工具错误] spawn_agent: 主 agent 未配置模型, 无法委派";
      // 懒建军团 (复用已有, 避免重复 spawn 进程)
      let L = agent._legion;
      if (!L) { L = new Legion(); agent._legion = L; }
      const role = String(args.role || "helper").replace(/[^\w-]/g, "_").slice(0, 24);

      const perspectives = Array.isArray(args.perspectives) ? args.perspectives.map((p) => String(p)).slice(0, tasks.length) : [];

      try {
        // 并行 spawn 子 agent: 每个独立数据目录 + 独立视角
        const names = tasks.map((_, i) => `${role}_${i}_${Date.now().toString(36)}`);
        for (const n of names) {
          L.spawnAgent(n, {
            dataDir: path.join(agent.dataDir, "legion", n),
            globalDataDir: agent.globalDataDir,
          });
        }
        // 生命周期: 繁衍计数 (ANS: reproducing)
        if (agent.lifecycle) agent.lifecycle.reproduced += names.length;

        // 并行派发, 全部等结果 (各自独立超时)
        const settled = await Promise.all(tasks.map(async (task, i) => {
          try {
            const reply = await Promise.race([
              L.send(names[i], { type: "chat", message: task, perspective: perspectives[i] }),
              new Promise((_, rej) => setTimeout(() => rej(new Error(`子任务${i + 1}超时 (${DELEGATE_TIMEOUT_MS / 1000}s)`)), DELEGATE_TIMEOUT_MS)),
            ]);
            return { ok: true, reply: reply.reply || "(子 agent 无回复)" };
          } catch (e) {
            return { ok: false, reply: `[子任务${i + 1}失败] ${e.message}` };
          }
        }));
        const results = settled.map((s) => s.reply);

        // 单任务: 保持旧行为, 直接返回子 agent 回复
        if (tasks.length === 1) return results[0];

        // 多任务: 有 arbitrate 走主 agent 仲裁聚合, 否则拼接各方结果
        if (args.arbitrate) {
          const out = await arbitrate(agent, tasks, results, perspectives, args.judge);
          return out;
        }
        return tasks.map((t, i) => {
          const p = perspectives?.[i] ? ` (${perspectives[i]})` : "";
          return `【子任务${i + 1}${p}】${t}\n${results[i]}`;
        }).join("\n\n");
      } catch (e) {
        return `[工具错误] spawn_agent: ${e.message}`;
      }
    },
  });
}
