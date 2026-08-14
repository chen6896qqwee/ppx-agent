// src/tools/selfmod.js - Self-modification 工具
// 参考 deepseek-harness 的 self-modification: agent 能检查/挂载/卸载自己的运行时能力
// 这里落地为"能力级自修改": 枚举能力(工具+技能) / 启用 / 禁用 / 加载技能, 不破坏零依赖内核
import { SkillLoader } from "../skills/loader.js";

function capErr(name, msg) {
  return `[工具错误] ${name}: ${msg}`;
}

export function registerSelfmodTools(catalog, { skillsDir }) {
  const loader = new SkillLoader(skillsDir);

  // 1. 枚举全部能力: 工具 + 技能
  catalog.register({
    name: "list_capabilities",
    description: "枚举当前所有可用的工具能力(category/power/enabled) 和已安装技能。用于 agent 了解自己能干啥。",
    parameters: { type: "object", properties: { kind: { type: "string", enum: ["tool", "skill", "all"], description: "all=工具+技能(默认)" } }, required: [] },
    category: "selfmod",
    power: "agent",
    idempotent: true,
    execute: async (args) => {
      const kind = args && args.kind ? args.kind : "all";
      const lines = [];
      if (kind === "all" || kind === "tool") {
        lines.push("— 工具 —");
        for (const t of catalog.listDetailed()) {
          lines.push(`[${t.enabled ? "ON" : "OFF"}] ${t.name} (${t.category}/${t.power})${t.timeoutMs ? ` 超时${t.timeoutMs}ms` : ""}`);
        }
      }
      if (kind === "all" || kind === "skill") {
        lines.push("— 技能 —");
        for (const s of loader.list()) {
          lines.push(`${s.id}: ${s.name} — ${s.description}`);
        }
      }
      return lines.join("\n");
    },
  });

  // 2. 启用能力
  catalog.register({
    name: "enable_capability",
    description: "启用一个已注册但被禁用的工具能力。name 为工具名。",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    category: "selfmod",
    power: "agent",
    execute: async (args) => {
      if (!catalog.enable(args.name)) return capErr("enable_capability", `未知工具: ${args.name}`);
      return `已启用: ${args.name}`;
    },
  });

  // 3. 禁用能力
  catalog.register({
    name: "disable_capability",
    description: "禁用工具能力(不卸载, 可随时启用)。name 为工具名。禁用后该工具不再出现在 LLM schema 且调用被拒。",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    category: "selfmod",
    power: "agent",
    execute: async (args) => {
      if (!catalog.disable(args.name)) return capErr("disable_capability", `未知工具: ${args.name}`);
      return `已禁用: ${args.name}`;
    },
  });

  // 4. 加载技能
  catalog.register({
    name: "load_skill",
    description: "读取一个已安装技能的 SKILL.md 全文, 供 agent 按需加载使用。id 为技能名。",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    category: "selfmod",
    power: "user",
    idempotent: true,
    execute: async (args) => {
      const content = loader.read(args.id);
      if (content === null) return capErr("load_skill", `未知技能: ${args.id}`);
      return `# ${args.id}\n\n${content}`;
    },
  });

  return catalog;
}
