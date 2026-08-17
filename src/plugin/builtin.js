// src/plugin/builtin.js - 皮皮虾内置插件集 (一切皆插件)
// 借鉴 deepseek-harness 的 "everything is a plugin": 每个模块是一个插件, 通过 ctx.provide 注册服务。
// 装配顺序即依赖顺序 (依赖在前), 任何插件都可被用户插件替换或扩展。
import path from "node:path";
import { Healer } from "../selfheal/healer.js";
import { Persona } from "../persona/index.js";
import { FactStore, MemoryTicker, Experience, L0Recorder, SceneStore, PersonaStore } from "../memory/index.js";
import { SessionStore } from "../memory/session.js";
import { LLMClient } from "../llm/index.js";
import {
  ToolCatalog, registerBuiltinTools, registerAdvancedTools, Scheduler,
  registerMethodTools, registerSelfmodTools, registerCustomTools, registerDocumentTools,
} from "../tools/index.js";
import { embedderFromConfig } from "../llm/embedder.js";
import { LocalShellProvider } from "../seam/shell.js";
import { Traces } from "../utils/trace.js";
import { ModeRegistry, registerDefaultModes } from "../mode/index.js";
import { planExecExecutor } from "../mode/plan-exec.js";
import { routerExecutor } from "../mode/router.js";
import { blackboardExecutor } from "../mode/blackboard.js";
import { graphExecutor } from "../mode/graph.js";
import { legionExecutor } from "../mode/legion.js";

// ---- 纯函数: LLM 解析 (从 agent 抽出, 修复 deepseek 后端识别) ----
// 判断 provider 是否可用: 有 api_key / 本地服务 / openclaw 或 deepseek 底座
function _isUsable(prov) {
  const key = prov.api_key || process.env[prov.api_key_env];
  const isLocal = /127\.0\.0\.1|localhost|lm-studio|ollama/i.test(prov.base_url || "");
  const isOpenclaw = prov.backend === "openclaw" || prov.id === "openclaw";
  const isDeepseek = prov.backend === "deepseek" || prov.backend === "dsh" || prov.id === "dsh";
  return !!(key || isLocal || isOpenclaw || isDeepseek);
}

function resolveAllLLMs(config) {
  const provs = (config && config.providers) || [];
  return provs.filter(_isUsable).map((p) => new LLMClient(p));
}

function resolveLLM(config) {
  const provs = (config && config.providers) || [];
  const p = provs.find(_isUsable);
  return p ? new LLMClient(p) : null;
}

// ---- 内置插件: 每个 (ctx) => void, 用 ctx.provide 注册服务 ----

export const healerPlugin = (ctx) => {
  const healer = new Healer(ctx.consume("root"));
  healer.markDirty();
  const health = healer.heal();
  ctx.provide("healer", healer);
  ctx.provide("health", health);
};

export const personaPlugin = (ctx) => {
  ctx.provide("persona", new Persona(ctx.consume("root")));
};

export const factsPlugin = (ctx) => {
  const config = ctx.consume("config");
  ctx.provide("facts", new FactStore(ctx.consume("dataDir"), config.memory || {}));
};

export const experiencePlugin = (ctx) => {
  ctx.provide("experience", new Experience(ctx.consume("dataDir")));
};

export const sessionPlugin = (ctx) => {
  ctx.provide("sessions", new SessionStore(ctx.consume("dataDir")));
};

export const memoryPlugin = (ctx) => {
  const facts = ctx.consume("facts");
  const sessions = ctx.consume("sessions");
  ctx.provide("memory", new MemoryTicker(ctx.consume("dataDir"), facts, null, sessions));
};

export const llmPlugin = (ctx) => {
  const config = ctx.consume("config");
  ctx.provide("llm", resolveLLM(config));
  ctx.provide("allProviders", resolveAllLLMs(config));
};

export const memoryLayersPlugin = (ctx) => {
  const sessions = ctx.consume("sessions");
  const dataDir = ctx.consume("dataDir");
  const userName = ctx.consume("userName") || "兄弟";
  ctx.provide("l0", new L0Recorder(sessions, dataDir));
  ctx.provide("scenes", new SceneStore(dataDir));
  ctx.provide("personaStore", new PersonaStore(dataDir, { userName }));
};

export const tracesPlugin = (ctx) => {
  ctx.provide("traces", new Traces(ctx.consume("dataDir")));
};

export const toolsPlugin = (ctx) => {
  const root = ctx.consume("root");
  const dataDir = ctx.consume("dataDir");
  const config = ctx.consume("config");
  const facts = ctx.consume("facts");
  const memory = ctx.consume("memory");
  const tools = new ToolCatalog();
  registerBuiltinTools(tools, { rootDir: root, facts, memory });
  const scheduler = new Scheduler(dataDir);
  ctx.provide("scheduler", scheduler);
  registerAdvancedTools(tools, { dataDir, scheduler, onMemoryNote: (note) => facts.add(note, { source: "schedule" }) });
  registerMethodTools(tools);
  registerSelfmodTools(tools, { skillsDir: path.join(root, "skills") });
  // 用户自定义工具 (不改源码扩展能力)
  const customDir = path.join(root, (config.tools && config.tools.custom_dir) || "custom-tools");
  registerCustomTools(tools, customDir);
  // 文档加载器 (RAG: read_document / ingest_document)
  registerDocumentTools(tools, { rootDir: root });
  // 向量化: 配了 config.embedding 则自动注入 embedder, 检索切 dense+BM25 RRF; 否则纯 BM25 兜底
  const embedder = embedderFromConfig(config);
  if (embedder) facts.setEmbedder(embedder);
  // Shell 能力 seam: 命令执行解耦为可替换 provider (本地/未来沙箱/Docker)
  ctx.provide("shell", new LocalShellProvider());
  ctx.provide("tools", tools);
  ctx.provide("toolsEnabled", config.tools?.enabled !== false);
};

export const modePlugin = (ctx) => {
  const registry = new ModeRegistry();
  registerDefaultModes(registry);
  // 更多编排模式 (可插拔): plan-exec / router / blackboard / graph
  registry.register("plan-exec", planExecExecutor);
  registry.register("router", routerExecutor);
  registry.register("blackboard", blackboardExecutor);
  registry.register("graph", graphExecutor);
  registry.register("legion", legionExecutor);
  ctx.provide("modes", registry);
};

// 默认内置插件装配顺序 (依赖在前)
export const builtinPlugins = [
  healerPlugin,
  personaPlugin,
  factsPlugin,
  experiencePlugin,
  sessionPlugin,
  memoryPlugin,
  llmPlugin,
  memoryLayersPlugin,
  tracesPlugin,
  toolsPlugin,
  modePlugin,
];
