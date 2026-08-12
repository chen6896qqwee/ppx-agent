// src/agent/index.js - Agent 引擎 (皮皮虾核心) v0.2 含工具调用
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

import { Healer } from "../selfheal/healer.js";
import { FactStore, MemoryTicker, Experience, L0Recorder, SceneStore, PersonaStore } from "../memory/index.js";
import { Persona } from "../persona/index.js";
import { LLMClient } from "../llm/index.js";
import { ToolCatalog, registerBuiltinTools, registerAdvancedTools, Scheduler, TOOL_ERROR_PREFIX } from "../tools/index.js";
import { registerMethodTools } from "../tools/index.js";
import { readJson, readText, ensureDir } from "../utils/store.js";
import { info, warn, error } from "../utils/logger.js";
import { Traces } from "../utils/trace.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_ERROR_RETRY = 2;
const MAX_SESSION_HISTORY = 20;   // ??????????(??)
const HISTORY_TOKEN_BUDGET = 4000; // ????? token ??????

// ?? token ??: ???1???0.6token, ??1token?4??
function estimateTokens(s){ return Math.ceil(String(s||'').length / 1.6); }

export class PPXAgent {
  constructor({ root = ROOT, configFile = null } = {}) {
    this.root = root;
    this.dataDir = path.join(root, "data");
    this.config = this._loadConfig(configFile);

    this.healer = new Healer(root);
    this.healer.markDirty();
    this.health = this.healer.heal();

    this.persona = new Persona(root);
    this.facts = new FactStore(this.dataDir, this.config.memory || {});
    this.experience = new Experience(this.dataDir);
    this.memory = new MemoryTicker(this.dataDir, this.facts);

    // 多 provider 回退: 优先有 API key 的 (各模型 API), 本地模型兜底
    this.llm = this._resolveLLM();
    this.allProviders = this._resolveAllLLMs();
    this.userName = this.config.user?.name || "兄弟";

    // 注入 LLM 摘要器给记忆压缩 (真摘要, 非堆叠)
    this.memory.summarizer = (raw) => this._summarizeMemory(raw);

    // 记忆系统: 腾讯风格四层 (L0对话→L1原子→L2场景→L3画像)
    this.l0 = new L0Recorder(this.dataDir);
    this.scenes = new SceneStore(this.dataDir);
    this.personaStore = new PersonaStore(this.dataDir, { userName: this.userName });

    // 工具系统
    this.traces = new Traces(this.dataDir);

    this.tools = new ToolCatalog();
    registerBuiltinTools(this.tools, { rootDir: this.root, facts: this.facts, memory: this.memory });
    this.scheduler = new Scheduler(this.dataDir);
    registerAdvancedTools(this.tools, { dataDir: this.dataDir, scheduler: this.scheduler, onMemoryNote: (note) => this.facts.add(note, { source: "schedule" }) });
    registerMethodTools(this.tools);
    this.toolsEnabled = this.config.tools?.enabled !== false;

    // ?????? (sessionKey -> [{role,content}]) ????????
    this.sessions = new Map();
  }


  // 选第一个可用的 provider (有 key 或本地服务)

  // 返回所有可用的 LLMClient (按配置顺序)
  _resolveAllLLMs() {
    const provs = this.config.providers || [];
    const clients = [];
    for (const prov of provs) {
      const key = prov.api_key || process.env[prov.api_key_env];
      const isLocal = /127\.0\.0\.1|localhost|lm-studio|ollama/i.test(prov.base_url || "");
      if (key || isLocal) clients.push(new LLMClient(prov));
    }
    return clients;
  }

  _resolveLLM() {
    const provs = this.config.providers || [];
    for (const prov of provs) {
      const key = prov.api_key || process.env[prov.api_key_env];
      const isLocal = /127.0.0.1|localhost|lm-studio|ollama/i.test(prov.base_url || "");
      if (key || isLocal) {
        return new LLMClient(prov);
      }
    }
    return null;
  }

  _loadConfig(configFile) {
    const candidates = [configFile, path.join(this.root, "config", "ppx.json"), path.join(this.root, "config", "ppx.yaml")].filter(Boolean);
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        if (c.endsWith(".json")) return readJson(c, {});
        if (c.endsWith(".yaml") || c.endsWith(".yml")) return this._parseYaml(c);
      }
    }
    return {};
  }

  _parseYaml(file) {
    const text = readText(file);
    const lines = text.split("\n").map((raw) => {
      const line = raw.replace(/\s*#.*$/, "").trimEnd();
      return { indent: line.search(/\S|$/), text: line.trim() };
    }).filter((l) => l.text && !l.text.startsWith("#"));

    const root = {};
    const stack = []; // { indent, obj, key }
    let arrIndent = -1;

    for (const { indent, text } of lines) {
      // 数组项: "- key: val" 或 "- val"
      const arrM = text.match(/^-\s+/);
      if (arrM) {
        const itemText = text.slice(arrM[0].length);
        // 找所属数组
        while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
        const parent = stack.length ? stack[stack.length - 1].obj : root;
        const arrKey = stack.length ? stack[stack.length - 1].arrKey : null;
        if (!arrKey) continue;
        if (!Array.isArray(parent[arrKey])) parent[arrKey] = [];
        const kv = itemText.match(/^([\w-]+):\s*(.*)$/);
        const item = {};
        if (kv) {
          item[kv[1]] = parseScalar(kv[2]);
          parent[arrKey].push(item);
          // 继续往里填
          stack.push({ indent, obj: item, arrKey: null });
        } else {
          parent[arrKey].push(parseScalar(itemText));
        }
        continue;
      }

      const m = text.match(/^([\w-]+):\s*(.*)$/);
      if (!m) continue;
      const [, key, val] = m;
      const v = val.trim();
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].obj : root;
      if (v === "") {
        parent[key] = {};
        stack.push({ indent, obj: parent[key], arrKey: null });
      } else {
        parent[key] = parseScalar(v);
        stack.push({ indent, obj: parent[key] ?? {}, arrKey: key });
        // 若值非对象(标量), arrKey 指向该标量会在数组项里误用, 重置
        if (typeof parent[key] !== "object") stack[stack.length - 1].arrKey = null;
      }
    }
    return root;

    function parseScalar(v) {
      if (v === "") return "";
      if (/^[\[{]/.test(v)) { try { return JSON.parse(v.replace(/'/g, '"')); } catch {} }
      if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
      if (v === "true") return true;
      if (v === "false") return false;
      if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
      return v;
    }
  }

  // 用 LLM 把旧对话浓缩成语义摘要 (Harness 上下文工程)
  async _summarizeMemory(raw) {
    if (!this.llm) throw new Error("无 LLM");
    const r = await this.llm.chat([
      { role: "system", content: "你是记忆压缩器。把下面这段对话记录压缩成一段简洁的中文摘要(≤200字), 保留关键事实、用户偏好、进展和待办。不要客套, 直接输出摘要。" },
      { role: "user", content: String(raw).slice(0, 4000) },
    ]);
    return r.content;
  }

  // ---- 多轮会话历史 (P0) ----
  _getSession(sessionKey) {
    const k = sessionKey || "default";
    if (!this.sessions.has(k)) this.sessions.set(k, []);
    return this.sessions.get(k);
  }

  // 追加一轮对话到会话历史, 并按 token 预算从头部滚动截断
  _pushTurn(sessionKey, userMsg, assistant) {
    const hist = this._getSession(sessionKey);
    hist.push({ role: "user", content: userMsg });
    if (assistant) hist.push({ role: "assistant", content: assistant });
    while (hist.length > MAX_SESSION_HISTORY) hist.shift();
    let total = 0, dropFrom = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      total += estimateTokens(hist[i].content);
      if (total > HISTORY_TOKEN_BUDGET) { dropFrom = i + 1; break; }
    }
    if (dropFrom > 0) this.sessions.set(sessionKey, hist.slice(dropFrom));
  }

  _loadHistory(sessionKey) {
    return this._getSession(sessionKey).map((m) => ({ ...m }));
  }

  // 重置某会话历史 (新会话)
  resetSession(sessionKey) { this.sessions.delete(sessionKey); }

  // 组装记忆上下文
  _context(userMsg) {
    const base = this.persona.systemPrompt(this.userName) + "\n\n" + this.memory.context() + "\n\n" + this.experience.context();
    const active = this.scenes.activeContext(userMsg || "");
    return active ? base + "\n\n" + active : base;
  }

  // 对话主入口 (含工具调用循环)
  async chat(userMsg, { persist = true, sessionKey = "default" } = {}) {
    const system = this._context(userMsg);
    // ??: [system] + [??] + [??????]
    const history = this._loadHistory(sessionKey);
    const messages = [{ role: "system", content: system }, ...history];

    // ????????? user ??(??), ??????
    const hist = this._getSession(sessionKey);
    const isRepeat = hist[hist.length - 1]?.role === "user" && hist[hist.length - 1].content === String(userMsg);
    if (!isRepeat) messages.push({ role: "user", content: String(userMsg) });

    let reply;
    if (this.llm) {
      try {
        reply = await this._llmWithFallback(messages);
      } catch (e) {
        error("LLM 调用失败:", e.message);
        reply = `[皮皮虾] LLM 调用失败: ${e.message}`;
      }
    } else {
      reply = "[皮皮虾] 未配置模型 provider，仅本地记忆 + 工具模式。配置 config/ppx.yaml 后启用完整对话。";
      // 离线时也尝试简单工具: 若用户意图明确调工具
      reply = await this._offlineToolRoute(userMsg) || reply;
    }

    if (persist) {
      this._pushTurn(sessionKey, String(userMsg), reply);
      await this.memory.recordTurn(userMsg, reply);
      this.l0.record({ role: "user", content: userMsg, sessionKey: "default" });
      this.l0.record({ role: "assistant", content: reply, sessionKey: "default" });
      // L2 场景归档: 从新记忆里找需要归档的
      this._archiveScenes();
      this._learnFromTurn(userMsg, reply);
    }
    return reply;
  }


  // 流式对话: 返回 { text, history } 或回调 onDelta 推送增量
  // 简化: 流式只用于无工具纯对话场景 (工具循环仍走非流式以保证轨迹完整性)
  async chatStream(userMsg, { sessionKey = "default", onDelta } = {}) {
    if (!this.llm) return this.chat(userMsg, { sessionKey });
    const system = this._context(userMsg);
    const history = this._loadHistory(sessionKey);
    const messages = [{ role: "system", content: system }, ...history, { role: "user", content: String(userMsg) }];
    let full = "";
    try {
      full = await this.llm.streamChat(messages, {
        onDelta: (d) => { full += d; onDelta && onDelta(d); },
      });
    } catch (e) {
      // 流式失败降级为非流式
      warn("流式失败, 降级非流式:", e.message);
      return this.chat(userMsg, { sessionKey });
    }
    this._pushTurn(sessionKey, String(userMsg), full);
    await this.memory.recordTurn(userMsg, full);
    this.l0.record({ role: "user", content: String(userMsg), sessionKey });
    this.l0.record({ role: "assistant", content: full, sessionKey });
    return full;
  }

  // 多 provider 回退: 依次尝试, 失败切下一个
  async _llmWithFallback(seedMessages) {
    const clients = this.allProviders.length ? this.allProviders : [this.llm];
    let lastErr = null;
    for (const client of clients) {
      try {
        return await this._llmWithTools(seedMessages, client);
      } catch (e) {
        lastErr = e;
        warn("provider 失败, 切换下一个:", client.model, e.message);
      }
    }
    throw lastErr || new Error("所有 provider 均失败");
  }

  // LLM + 工具调用循环 (带 provider 回退)
  async _llmWithTools(seedMessages, llmInstance = this.llm) {
    const messages = [...seedMessages];
    const tools = this.toolsEnabled ? this.tools.toOpenAI() : [];
    let errorRetries = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await llmInstance.apiChat(messages, { tools });
      const msg = resp.message;
      messages.push(msg);

      const toolCalls = msg.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return msg.content || "[皮皮虾] (无回复)";
      }

      // 工具错误重试: 若本轮有工具失败, 汇总错误喂回模型修正后重试 (最多 errorRetries 次)
      const errors = [];
      for (const tc of toolCalls) {
        if (tc.type === "function" && tc.function) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
          const t0 = Date.now();
          const result = await this.tools.call(tc.function.name, args, { agent: this });
          this.traces.record({
            tool: tc.function.name,
            args,
            result: result.slice(0, 800),
            ok: !result.startsWith(TOOL_ERROR_PREFIX),
            durationMs: Date.now() - t0,
            error: result.startsWith(TOOL_ERROR_PREFIX) ? result : null,
          });
          messages.push({ role: "tool", tool_call_id: tc.id, content: result });
          if (result.startsWith(TOOL_ERROR_PREFIX)) errors.push(result);
        }
      }
      if (errors.length && errorRetries < MAX_TOOL_ERROR_RETRY) {
        errorRetries++;
        messages.push({
          role: "user",
          content: "以下工具调用失败, 请修正参数或改用其他方式后重试:\n" + errors.join("\n"),
        });
        continue;
      }
    }
    return "[皮皮虾] 工具调用轮次过多, 已停止。";
  }

  // 离线工具路由: 无 LLM 时识别简单工具指令
  async _offlineToolRoute(userMsg) {
    const m = String(userMsg).trim();
    const read = m.match(/^读文件\s+(.+)$/i);
    if (read) return `[工具] ${await this.tools.call("read_file", { path: read[1].trim() })}`;
    const list = m.match(/^列出?\s+(\S+)?$/i);
    if (list) return `[工具] ${await this.tools.call("list_dir", { path: list[1] || "." })}`;
    const time = m.match(/^时间$/i);
    if (time) return `[工具] ${await this.tools.call("get_time", {})}`;
    const search = m.match(/^记住[:：]\s*(.+)$/i);
    if (search) return `[工具] ${await this.tools.call("memory_add", { content: search[1].trim() })}`;
    return null;
  }

  _learnFromTurn(userMsg, reply) {
    const m = String(userMsg).match(/经验交给皮皮虾[:：]\s*(.+)/i);
    if (m) {
      this.experience.learn({ task: "用户主动分享", lesson: m[1], tags: ["user-shared"] });
      info(`学到经验: ${m[1]}`);
    }
  }


  // 把新记忆归档进 L2 场景
  _archiveScenes() {
    const recent = this.facts.query("", { limit: 5 });
    for (const f of recent) {
      if (!this.scenes.findByFactId(f.id)) this.scenes.assign(f);
    }
  }

  shutdown() {
    this.memory._saveState?.();
    this.healer.markClean();
  }
}

if (process.argv[1] && process.argv[1].endsWith("src/agent/index.js")) {
  const agent = new PPXAgent();
  console.log(`皮皮虾 就绪 | 记忆:${agent.facts.count()}条 | 工具:${agent.tools.list().join(",")} | 自愈:${agent.health.fixes.length ? "修复" + agent.health.fixes.length + "项" : "OK"}`);
  process.stdin.on("data", async (d) => {
    const line = d.toString().trim();
    if (["quit", "exit"].includes(line)) { agent.shutdown(); process.exit(0); }
    const r = await agent.chat(line);
    console.log("\n" + r + "\n");
  });
}