// src/agent/index.js - Agent 引擎 (皮皮虾核心) v0.2 含工具调用
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { TOOL_ERROR_PREFIX } from "../tools/index.js";
import { imageFileToDataUrl } from "../tools/builtin.js";
import { logicalDay } from "../utils/store.js";
import { loadConfig } from "../config/index.js";
import { LLMClient } from "../llm/client.js";
import { info, warn, error } from "../utils/logger.js";
import { Context, compose, loadPlugins } from "../plugin/index.js";
import { builtinPlugins } from "../plugin/builtin.js";
import { registerMcpTools } from "../mcp/index.js";
import { buildCompactionMessages, transcriptToText } from "../memory/compaction.js";

// 热重载用 LLM 客户端构造 (与 plugin/builtin.llmPlugin 行为一致)
const LLMClientForReload = LLMClient;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAX_TOOL_ROUNDS = 8;
const TOOL_RESULT_BUDGET = 4000; // L4 toolResultBudget: 工具结果超过此长度裁剪, 防撑爆上下文
const MAX_TOOL_ERROR_RETRY = 2;
// 会话历史条数/token 预算已迁到 config.memory (max_history_items / history_token_budget)

// 估算 token: 中文字符约1字=0.6token, 1token约4字符
function estimateTokens(s){ return Math.ceil(String(s||'').length / 1.6); }

// L4 toolResultBudget: 裁剪超长工具结果, 保留头尾关键信息
export function trimToolResult(r) {
  const s = String(r || "");
  if (s.length <= TOOL_RESULT_BUDGET) return s;
  const head = s.slice(0, TOOL_RESULT_BUDGET * 0.7);
  const tail = s.slice(-TOOL_RESULT_BUDGET * 0.3);
  return head + `\n...[结果已裁剪: 共 ${s.length} 字符, 保留头尾 ${TOOL_RESULT_BUDGET}]...\n` + tail;
}

// 多模态: 提取 user 消息中的图片路径并同步读图, 注入为 OpenAI 视觉格式的 content 数组。
// 仅当当前 LLM 是 http 后端且 provider 标记 vision=true 时生效 (openclaw/dsh 走文本围栏不传图)。
// 返回 string (无图/不支持) 或 [{type:text}, {type:image_url}...]
function _visionUserContent(llm, root, userMsg) {
  const text = String(userMsg);
  if (!llm || llm.backend !== "http" || !llm.vision) return text;
  const paths = [];
  for (const m of text.matchAll(/[^\s"'`，。；;：:,，()（）]+\.(?:png|jpe?g|gif|webp|bmp)/gi)) {
    paths.push(m[0]);
  }
  if (!paths.length) return text;
  const content = [{ type: "text", text }];
  for (const p of [...new Set(paths)].slice(0, 4)) {
    try {
      const dataUrl = imageFileToDataUrl(root, p);
      content.push({ type: "image_url", image_url: { url: dataUrl } });
    } catch { /* 读图失败静默跳过, 保留纯文本 */ }
  }
  return content.length > 1 ? content : text;
}

// 工具结果 → OpenAI 消息 content: 图片 data URL 转 image_url 块 (多模态), 否则文本裁剪
export function toToolContent(result) {
  const s = String(result || "");
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(s)) {
    return [{ type: "image_url", image_url: { url: s } }];
  }
  return trimToolResult(s);
}

export class PPXAgent {
  constructor({ root = ROOT, configFile = null, plugins = [], dataDir = null, globalDataDir = null } = {}) {
    this.root = root;
    // dataDir 可覆盖: 显式参数 > PPX_DATA_DIR 环境变量 > 默认目录
    // 默认目录: 包装在 node_modules 里时外置到 ~/.ppx (防卸载丢数据), 否则 root/data
    this.dataDir = dataDir || process.env.PPX_DATA_DIR || this._defaultDataDir(root);
    // 全局共享数据目录 (跨 agent 共享经验等): 显式参数 > PPX_AGENT_GLOBAL_DATA_DIR > 本地 dataDir
    this.globalDataDir = globalDataDir || process.env.PPX_AGENT_GLOBAL_DATA_DIR || this.dataDir;
    this.config = this._loadConfig(configFile);
    this.userName = this.config.user?.name || "兄弟";

    // 插件装配: ctx 预置基础服务, 按顺序装配内置 + 用户插件 (一切皆插件)
    this.ctx = new Context();
    this.ctx.provide("root", root);
    this.ctx.provide("dataDir", this.dataDir);
    this.ctx.provide("globalDataDir", this.globalDataDir);
    this.ctx.provide("config", this.config);
    this.ctx.provide("userName", this.userName);
    this.ctx.provide("agent", this);
    // 装配顺序: 内置插件 → 用户插件目录(声明式) → 构造函数传入插件(编程式)
    const pluginsDir = path.join(root, this.config.plugins?.dir || "plugins");
    compose(this.ctx, [...builtinPlugins, ...loadPlugins(pluginsDir), ...plugins]);

    // 从 ctx 取服务, 设置公开属性 (向后兼容, 外部代码不变)
    this.healer = this.ctx.consume("healer");
    this.health = this.ctx.consume("health");
    this.persona = this.ctx.consume("persona");
    this.facts = this.ctx.consume("facts");
    this.experience = this.ctx.consume("experience");
    this.sessionStore = this.ctx.consume("sessions");
    this.memory = this.ctx.consume("memory");
    this.llm = this.ctx.consume("llm");
    this.allProviders = this.ctx.consume("allProviders");
    this.l0 = this.ctx.consume("l0");
    this.scenes = this.ctx.consume("scenes");
    this.personaStore = this.ctx.consume("personaStore");
    this.traces = this.ctx.consume("traces");
    this.tools = this.ctx.consume("tools");
    this.scheduler = this.ctx.consume("scheduler");
    this.toolsEnabled = this.ctx.consume("toolsEnabled");

    // 注入 LLM 摘要器/提炼器 (依赖 agent 方法, 装配后注入)
    this.memory.summarizer = (raw) => this._summarizeMemory(raw);
    this.memory.setExtractor((u, a) => this._extractMemory(u, a));

    // 主动通知 + 中断状态
    this._notifyCb = null;
    this._onToolEvent = null; // 工具事件回调
    this._interrupted = false;
    this._lastTurnUsedTools = false;
    this._mcp = null; // MCP 连接句柄 (connectMcp 后赋值)
    this._personaBuilt = null; // L3 画像上次生成日期 (跨天刷新)

    // 可选: 启动时自动连接 MCP 服务器 (config.mcp.auto_connect = true 时非阻塞连接)
    if (this.config.mcp?.auto_connect && this.config.mcp.servers?.length) {
      this.connectMcp()
        .then((n) => { if (n) info(`[mcp] 自动连接 ${n} 个 MCP 工具`); })
        .catch((e) => warn(`[mcp] 自动连接失败: ${e.message}`));
    }

    // 首次启动生成 L3 画像 (零依赖高频词统计, 同步快, 不调 LLM)
    this._maybeRefreshPersona();
  }


  
  // 默认数据目录: 包装在 node_modules 里(全局/本地安装)时外置到 ~/.ppx, 否则 root/data
  _defaultDataDir(root) {
    if (String(root).includes("node_modules")) return path.join(os.homedir(), ".ppx");
    return path.join(root, "data");
  }

  // 主动通知 + 中断 API
  setNotify(cb) { this._notifyCb = typeof cb === "function" ? cb : null; }
  // 工具调用过程可视化 - 回调 (tool名, 参数, 耗时, 状态) 供 Web UI 推送
  setToolEvent(cb) { this._onToolEvent = typeof cb === "function" ? cb : null; }
  // turn/step 分层: 推理轮次事件 (每轮工具循环发一次 step), 供军团 worker 上报进度
  setStepEvent(cb) { this._onStepEvent = typeof cb === "function" ? cb : null; }
  notify(message) { if (this._notifyCb) { try { this._notifyCb(String(message)); } catch (e) {} } }
  interrupt() { this._interrupted = true; }
  clearInterrupt() { this._interrupted = false; }

  _loadConfig(configFile) {
    return loadConfig(this.root, configFile);
  }

  // P1#9: LLM 结构化记忆提炼 - 从高信号对话提取关键事实/偏好/待办 (替代简单启发式)
  async _extractMemory(user, assistant) {
    if (!this.llm) return [];
    const r = await this.llm.chat([
      { role: "system", content: "你是记忆提炼器。从对话中提取值得长期记忆的关键事实、用户偏好、待办事项。只输出 JSON 数组, 每项是{content: 一句完整中文记忆}。没有值得记的返回 []。不要解释, 只输出 JSON。" },
      { role: "user", content: "用户: " + String(user).slice(0, 800) + "\n助手: " + String(assistant).slice(0, 800) },
    ]);
    const text = String(r.content || "").trim();
    // 容忍模型把 JSON 包在 markdown 代码块里
    const cleaned = text.replace(/```(?:json|JSON)?\s*/g, "").replace(/```/g, "").trim();
    // 提取第一个最外层 JSON 数组 (贪婪匹配到最后一个 ], 容忍内容里的嵌套方括号)
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      const arr = JSON.parse(m[0]);
      return Array.isArray(arr) ? arr.map((x) => String(x.content || x).trim()).filter(Boolean) : [];
    } catch { return []; }
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

  // P1: LLM 查询扩展 - 把问题改写成多个词面变体, 补语义召回 (零依赖, 复用已有 LLM)
  async _expandQuery(q) {
    const r = await this.llm.chat([
      { role: "system", content: "你是查询扩展器。把用户的问题改写成 3 个语义相近但词面不同的检索短语(用于语义记忆检索), 每行一个, 不要序号、不要解释。" },
      { role: "user", content: String(q).slice(0, 300) },
    ]);
    return String(r.content || "")
      .split(/\n+/)
      .map((s) => s.replace(/^[\d\.\-、)）]\s*/, "").trim())
      .filter((s) => s && s !== String(q).trim())
      .slice(0, 3);
  }

  // P1: 语义记忆检索 - 原始查询 + LLM 扩展变体做 RRF 融合; 无 LLM 时退化为单查询
  async _memoryQuery(q, { limit = 5, scope = null } = {}) {
    // 有 embedder 时走 dense 语义检索 (与 BM25 RRF 融合), 否则 LLM 扩展 + RRF
    if (this.facts.embedder) {
      return this.facts.querySemantic(q, { limit, scope });
    }
    const variants = [q];
    if (this.llm) {
      try { variants.push(...(await this._expandQuery(q))); } catch { /* LLM 失败静默降级 */ }
    }
    if (variants.length === 1) return this.facts.query(q, { limit, scope });
    return this.facts.queryMulti(variants, { limit, scope });
  }

  // ---- 多轮会话历史 (吸收 dsh "会话即事实源") ----
  // 历史从事件日志投影, 再按预算裁剪 (裁剪只发生在投影层, 日志本身不可变)
  // v0.6.6 优化: 信息量感知裁剪 (学自 Claude Code Microcompact 思路)
  //   旧版: 纯按条数硬截 + 尾部 token 预算, 可能裁掉关键决策/工具结果轮次
  //   新版: 优先保留"含关键信息"的轮次(指令/数字/路径/结论/工具结果), 纯寒暄让位
  _historyPriority(m) {
    const s = String(m?.content || "");
    if (!s) return 0;
    let p = 0;
    // 长消息(含工具结果/详细决策)权重高
    if (s.length > 120) p += 2;
    // 含指令/结论/数字/路径/文件等关键信号
    if (/[查|算|计算|写|建|改|创建|删除|修复|总结|分析|设置|配置|执行|运行|启动|停止|提交|部署|安装|生成|编译|测试]/.test(s)) p += 2;
    if (/[0-9]{2,}|[%.¥$元%]|[:：][0-9]/.test(s)) p += 1;
    if (/[A-Za-z]:[\\\/]|\.(js|py|md|json|txt|ts|go|rs|cpp|java|log)\b/.test(s)) p += 2;
    if (/失败|错误|报错|异常|成功|完成|结果|结论|决定|方案|建议/.test(s)) p += 2;
    // 纯寒暄/简短确认权重低
    if (/^(你好|hi|hello|在吗|谢谢|好的|ok|嗯|是的|对|收到|知道|了解|再见|拜拜)/i.test(s.trim())) p -= 3;
    return p;
  }
  _trimHistory(hist) {
    let h = [...hist];
    const maxItems = Number(this.config.memory?.max_history_items) || 40;
    const tokenBudget = Number(this.config.memory?.history_token_budget) || 4000;
    // 1) 条数上限: 超限时按信息量淘汰 (低信息量优先, 从旧到新)
    if (h.length > maxItems) {
      const scored = h.map((m, i) => ({ m, i, p: this._historyPriority(m) }));
      scored.sort((a, b) => (a.p - b.p) || (a.i - b.i));
      const drop = scored.length - maxItems;
      const dropped = new Set(scored.slice(0, drop).map((x) => x.i));
      scored.sort((a, b) => a.i - b.i);
      h = scored.filter((x) => !dropped.has(x.i)).map((x) => x.m);
    }
    // 2) token 预算: 信息量感知裁剪 (替代旧版"丢最旧前缀")
    //    必保最近一条, 其余按信息量从高到低补足, 低信息量轮次让位
    let total = h.reduce((a, m) => a + estimateTokens(m.content), 0);
    if (total > tokenBudget) {
      const keep = new Set();
      let used = 0;
      const lastIdx = h.length - 1;
      keep.add(lastIdx); used += estimateTokens(h[lastIdx].content);
      const rest = h.slice(0, lastIdx)
        .map((m, i) => ({ m, i, p: this._historyPriority(m) }))
        .sort((a, b) => (b.p - a.p) || (a.i - b.i));
      for (const { m, i } of rest) {
        const t = estimateTokens(m.content);
        if (used + t > tokenBudget) continue;
        keep.add(i); used += t;
      }
      h = h.filter((_, i) => keep.has(i));
    }
    return h;
  }

  _getSession(sessionKey) {
    return this._trimHistory(this.sessionStore.deriveCompacted(sessionKey || "default"));
  }

  // 追加一轮对话为不可变事件 (append-only, 永不重写日志)
  _pushTurn(sessionKey, userMsg, assistant) {
    const k = sessionKey || "default";
    this.sessionStore.append(k, "user/message", { content: String(userMsg) });
    if (assistant) this.sessionStore.append(k, "assistant/message", { content: String(assistant) });
  }

  // 加载历史: 先尝试结构化压缩(超阈值), 再按预算裁剪
  async _loadHistory(sessionKey) {
    const k = sessionKey || "default";
    await this._maybeCompact(k);
    return this._getSession(k).map((m) => ({ ...m }));
  }

  // 会话压缩: 未压缩部分超 token 阈值时, 把最旧一半压成结构化摘要并持久化到日志
  // (吸收 OpenClaw compaction: 摘要替换被压缩区间, 日志本身不可变)
  async _maybeCompact(sessionKey) {
    if (!this.llm) return;
    const events = this.sessionStore.replay(sessionKey);
    let upToSeq = 0;
    for (const e of events) if (e.type === "compaction/summary") upToSeq = e.data?.upToSeq || 0;
    const tail = events.filter((e) => e.seq > upToSeq && (e.type === "user/message" || e.type === "assistant/message"));
    if (!tail.length) return;
    const tokenBudget = Number(this.config.memory?.history_token_budget) || 4000;
    const total = tail.reduce((a, e) => a + estimateTokens(e.data?.content), 0);
    if (total <= tokenBudget * 1.5) return; // 未超阈值不压缩
    const split = Math.floor(tail.length / 2);
    const old = tail.slice(0, split);
    if (old.length < 2) return; // 太少不值得压
    const lastSeq = old[old.length - 1].seq;
    const transcript = transcriptToText(old.map((e) => ({ role: e.type === "user/message" ? "user" : "assistant", content: e.data?.content })));
    try {
      const r = await this.llm.chat(buildCompactionMessages(transcript));
      const summary = r?.content;
      if (summary) this.sessionStore.append(sessionKey, "compaction/summary", { summary, upToSeq: lastSeq });
    } catch {
      // 压缩失败静默降级, 交给 _trimHistory 硬裁剪
    }
  }

  // 重置某会话历史 (新会话): 删除事件日志
  resetSession(sessionKey) { this.sessionStore.delete(sessionKey || "default"); }

  // 组装记忆上下文
  _context(userMsg) {
    const base = this.persona.systemPrompt(this.userName) + "\n\n" + this.memory.context(userMsg) + "\n\n" + this.experience.context() + this._l3Context();
    // 引用规则 + 额外 system 内容均可配置 (agent.citation_rule / agent.system_extra)
    const citation = this.config.agent?.citation_rule || "";
    const extra = this.config.agent?.system_extra || "";
    const active = this.scenes.activeContext(userMsg || "");
    const baseCtx = active ? base + "\n\n" + active : base;
    return [baseCtx, citation, extra].filter(Boolean).join("\n\n");
  }

  // L3 画像注入: 已生成的用户画像 + agent 自我画像 (未生成返回 "")
  _l3Context() {
    try {
      const parts = [];
      const u = this.personaStore.userPersona();
      const a = this.personaStore.agentPersona();
      if (u) parts.push(u);
      if (a) parts.push(a);
      return parts.length ? "\n\n" + parts.join("\n\n") : "";
    } catch { return ""; }
  }

  // L3 画像刷新: 跨天触发 (内存日期标记, 每天首次对话刷新一次)
  _maybeRefreshPersona() {
    const today = logicalDay();
    if (this._personaBuilt === today) return;
    this._personaBuilt = today;
    try {
      this.personaStore.buildUserPersona(this.facts.list(), { force: true });
      this.personaStore.buildAgentPersona(this.experience.lessons, { force: true });
    } catch (e) {
      warn("L3 画像生成失败:", e.message);
    }
  }

  // 找视觉 provider: 当前 LLM 若是 vision 直接用, 否则从 allProviders 找第一个 vision
  _visionLLM() {
    if (this.llm && this.llm.vision) return this.llm;
    return (this.allProviders || []).find((p) => p.vision) || null;
  }

  // 多模态 user 消息内容: 有图且存在 vision provider 时返回 content 数组, 否则纯文本
  _userContent(userMsg) {
    return _visionUserContent(this._visionLLM(), this.root, userMsg);
  }

  // 对话主入口 (含工具调用循环)
  async chat(userMsg, { persist = true, sessionKey = "default", mode = null } = {}) {
    this.clearInterrupt(); // 新一轮对话开始, 复位上一轮的中断状态
    let reply;
    // 内核自主决策: 高置信简单指令本地处理, 不调 LLM
    const local = (this.config.agent?.localIntent !== false) ? await this._localIntent(userMsg) : null;
    if (local) {
      reply = local;
    } else {
      // 模式分发: 编排策略可插拔 (react/single, 未来 plan-exec/multi-agent/graph 等)
      const modeName = mode || this.config.agent?.mode || "react";
      try {
        reply = await this.ctx.consume("modes").run(modeName, this, userMsg, { sessionKey });
      } catch (e) {
        error("LLM 调用失败:", e.message);
        reply = `[皮皮虾] LLM 调用失败: ${e.message}`;
      }
    }

    const usedTools = this._lastTurnUsedTools;
    this._lastTurnUsedTools = false;
    if (this._notifyCb && usedTools) this.notify("[done] task finished (tool-backed).");

    if (persist) {
      this._pushTurn(sessionKey, String(userMsg), reply);
      await this.memory.recordTurn(userMsg, reply);
      // L2 场景归档: 从新记忆里找需要归档的
      this._archiveScenes();
      this._learnFromTurn(userMsg, reply);
      // L3 画像: 跨天刷新 (吸收新记忆/经验)
      this._maybeRefreshPersona();
    }
    return reply;
  }


  // 流式对话: 返回 { text, history } 或回调 onDelta 推送增量
  // 支持工具循环: 若消息触发工具调用, 走 _llmWithTools (触发 onTool 事件推送工具活动),
  // 最终结果作为一次 delta 推送; 否则走 streamChat 逐字流式 [P1#7]
  async chatStream(userMsg, { sessionKey = "default", onDelta, onTool, onStep } = {}) {
    if (!this.llm) return this.chat(userMsg, { sessionKey });
    this.clearInterrupt(); // 新一轮对话开始, 复位中断状态
    // 内核自主决策: 高置信简单指令本地处理
    const local = (this.config.agent?.localIntent !== false) ? await this._localIntent(userMsg) : null;
    if (local) { onDelta && onDelta(local); return local; }
    const system = this._context(userMsg);
    const history = await this._loadHistory(sessionKey);
    const messages = [{ role: "system", content: system }, ...history, { role: "user", content: this._userContent(userMsg) }];

    // 多模态路由: 消息含图片时优先 vision provider (否则图片发到文本后端无意义)
    const hasImage = messages.some((m) => Array.isArray(m.content) && m.content.some((c) => c && c.type === "image_url"));
    const activeLLM = hasImage ? (this._visionLLM() || this.llm) : this.llm;

    // 挂工具事件透传 (供 onTool 推送)
    const prevCb = this._onToolEvent;
    if (onTool) this._onToolEvent = (ev) => { try { onTool(ev); } catch {} };
    // 挂 step 事件透传 (供 onStep 推送推理轮次)
    const prevStepCb = this._onStepEvent;
    if (onStep) this._onStepEvent = (ev) => { try { onStep(ev); } catch {} };

    let reply;
    try {
      // 无工具开启: 直连后端可逐字流式 (恢复打字机效果); 有工具时走工具循环保轨迹完整 [复审 P2]
      if (!this.toolsEnabled && activeLLM.supportsStream) {
        reply = await activeLLM.streamChat(messages, {
          onDelta: (d) => { onDelta && onDelta(d); },
        });
      } else {
        reply = await this._llmWithTools(messages, activeLLM);
        if (onDelta) onDelta(reply);
      }
    } catch (e) {
      warn("chatStream 失败, 降级非流式 chat:", e.message);
      reply = await this.chat(userMsg, { sessionKey });
      if (onDelta) onDelta(reply);
    } finally {
      this._onToolEvent = prevCb;
      this._onStepEvent = prevStepCb;
    }
    this._pushTurn(sessionKey, String(userMsg), reply);
    await this.memory.recordTurn(userMsg, reply);
    return reply;
  }

  // 多 provider 回退: 依次尝试, 失败切下一个
  // 多 provider 并发健康探测 + 回退: 只对可用 provider 调用, 避免串行等待 180s 超时
  async _llmWithFallback(seedMessages) {
    let clients = this.allProviders.length ? this.allProviders : [this.llm];
    // 多模态路由: 消息含图片 (image_url 块) 时, 优先 vision provider, 避免图片发到文本后端浪费
    const hasImage = seedMessages.some((m) => Array.isArray(m.content) && m.content.some((c) => c && c.type === "image_url"));
    if (hasImage) {
      const visionClients = clients.filter((c) => c.vision);
      if (visionClients.length) clients = visionClients;
      else info("消息含图片但无 vision provider, 图片将无法被模型理解 (请配置 vision: true 的 provider)");
    }
    // 工具类任务: 优先原生 tool_calls 后端 (http)。
    // openclaw 是完整 agent 运行时, 会拒绝围栏协议(视为伪协议); 实测 http 原生 tool_calls 全链路通过。
    if (this.toolsEnabled) {
      const native = clients.filter((c) => c.supportsNativeToolCalls);
      const fence = clients.filter((c) => !c.supportsNativeToolCalls);
      if (native.length) clients = [...native, ...fence];
    }
    if (clients.length > 1) {
      try {
        const states = await Promise.all(clients.map((c) => c.health ? c.health() : Promise.resolve(true)));
        const healthy = clients.filter((_, i) => states[i]);
        if (healthy.length) clients = healthy;
        else info("所有 provider 健康探测失败, 按原配置顺序尝试兜底");
      } catch (e) {
        warn("health 探测异常, 按原顺序回退:", e.message);
      }
    }
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

  // 统一工具执行入口 (供 http 原生 tool_calls + openclaw/dsh 围栏代理共用) [P0#1]
  async _runTool(name, args, llmInstance) {
    const t0 = Date.now();
    this._lastTurnUsedTools = true;
    if (this._onToolEvent) { try { this._onToolEvent({ type: "start", tool: name, args, ts: Date.now() }); } catch {} }
    const result = await this.tools.call(name, args, { agent: this });
    const ok = !result.startsWith(TOOL_ERROR_PREFIX);
    this.traces.record({
      tool: name,
      args,
      result: result.slice(0, 800),
      ok,
      durationMs: Date.now() - t0,
      error: ok ? null : result,
    });
    if (this._onToolEvent) { try { this._onToolEvent({ type: "done", tool: name, args, ok, durationMs: Date.now() - t0, result: result.slice(0, 300), ts: Date.now() }); } catch {} }
    return result;
  }

  // LLM + 工具调用循环 (带 provider 回退)
  async _llmWithTools(seedMessages, llmInstance = this.llm) {
    const messages = [...seedMessages];
    const tools = this.toolsEnabled ? this.tools.toOpenAI() : [];
    let errorRetries = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (this._interrupted) return "[interrupted] task cancelled by operator.";
      if (this._onStepEvent) { try { this._onStepEvent({ type: "step", round, maxRounds: MAX_TOOL_ROUNDS, ts: Date.now() }); } catch {} }
      const resp = await llmInstance.apiChat(messages, {
        tools,
        toolRunner: async (name, args) => this._runTool(name, args, llmInstance),
      });
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
          this._lastTurnUsedTools = true;
          const result = await this.tools.call(tc.function.name, args, { agent: this });
          this.traces.record({
            tool: tc.function.name,
            args,
            result: result.slice(0, 800),
            ok: !result.startsWith(TOOL_ERROR_PREFIX),
            durationMs: Date.now() - t0,
            error: result.startsWith(TOOL_ERROR_PREFIX) ? result : null,
          });
          messages.push({ role: "tool", tool_call_id: tc.id, content: toToolContent(result) });
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
  // ---- 内核自主决策: 本地意图预判层 (P2-7) ----
  // 高置信简单指令(问候/时间/记忆/明确工具)本地处理, 不调 LLM, 省成本更快
  async _localIntent(userMsg) {
    const m = String(userMsg).trim();
    // 纯问候/告别/感谢 (短句, 高置信)
    const greet = /^(你好|您好|嗨|哈喽|hello|hi|在吗|早上好|晚上好|下午好|再见|拜拜|谢谢|感谢|辛苦了|good\s*(mom|afternoon|evening)|thanks?|bye)\s*[!。？?]*$/i;
    if (greet.test(m)) {
      if (/再见|拜拜|bye/i.test(m)) return "再见兄弟, 有事随时喊我。";
      if (/谢谢|感谢|辛苦/i.test(m)) return "客气啥, 应该的。";
      return "在的兄弟, 说。";
    }
    // 时间/日期
    if (/^(现在)?(几点|时间|日期|几号|今天|星期几)[!?。？]*$/i.test(m)) {
      return `[工具] ${await this.tools.call("get_time", {})}`;
    }
    // 记忆查询: 你记得XXX / 上次聊过XXX (P1: LLM 查询扩展 + RRF 融合补语义召回)
    if (/^(你)?(记得|还记得|上次聊过|关于)[:：]?\s*(.+)/i.test(m)) {
      const q = m.replace(/^(你)?(记得|还记得|上次聊过|关于)[:：]?\s*/i, "").trim();
      const res = await this._memoryQuery(q || m, { limit: 3 });
      return res.length ? "我记得:\n" + res.map(r => `- ${r.content}`).join("\n") : `(记忆里没找到关于"${q || m}"的)`;
    }
    // 记住 XX
    const add = m.match(/^记住[:：]\s*(.+)$/i);
    if (add) return `[工具] ${await this.tools.call("memory_add", { content: add[1].trim() })}`;
    // 读文件 / 列目录 (明确工具指令)
    const read = m.match(/^读文件\s+(.+)$/i);
    if (read) return `[工具] ${await this.tools.call("read_file", { path: read[1].trim() })}`;
    const list = m.match(/^列出?\s+(\S+)?$/i);
    if (list) return `[工具] ${await this.tools.call("list_dir", { path: list[1] || "." })}`;
    return null;
  }

  // ---- Session Replay: 从 l0 原始日志恢复某会话历史 (跨天/崩溃续跑) ----
  replaySession(sessionKey = "default", { days = 7, limit = 40 } = {}) {
    const msgs = [];
    const now = new Date();
    for (let d = days - 1; d >= 0; d--) {
      const day = logicalDay(new Date(now.getTime() - d * 86400000));
      const recs = this.l0.read(day, 2000);
      for (const r of recs) {
        if (r.sessionKey !== sessionKey) continue;
        if (r.role === "user" || r.role === "assistant") msgs.push({ role: r.role, content: r.content, ts: r.timestamp });
      }
    }
    msgs.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return msgs.slice(-limit).map(({ role, content }) => ({ role, content }));
  }

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

  // P3: 自我进化闭环 - 回放近期失败轨迹, LLM 提炼经验教训进经验库 (轨迹 → 经验 → 注入上下文)
  // 复用已有 experience.learn, 把「哪一步坏了」沉淀为可复用教训
  async refine({ limit = 20 } = {}) {
    if (!this.llm) return { distilled: 0, reason: "无 LLM" };
    const failed = this.traces.read(undefined, limit).filter((t) => !t.ok);
    if (failed.length < 2) return { distilled: 0, reason: "失败轨迹不足" };
    const summary = failed
      .map((t) => `工具 ${t.tool}: ${String(t.error || t.result || "").slice(0, 160)}`)
      .join("\n");
    let lesson;
    try {
      const r = await this.llm.chat([
        { role: "system", content: "你是经验提炼器。从失败的工具调用轨迹中提炼一条可复用的经验教训, 一句话说清: 什么场景、为什么失败、下次怎么做。只输出这一句话, 不要解释。" },
        { role: "user", content: summary.slice(0, 2000) },
      ]);
      lesson = String(r.content || "").trim();
    } catch { lesson = ""; }
    if (!lesson) return { distilled: 0, reason: "LLM 未产出经验" };
    this.experience.learn({ task: "自动提炼", lesson, tags: ["auto-refine"] });
    info(`[refine] 学到经验: ${lesson}`);
    return { distilled: 1, lesson };
  }

  // P2: 自我进化闭环 (下) - 从成功轨迹自动提炼可复用 Skill
  // 轨迹 → 高频成功工具模式 → LLM 提炼 → 复用 create_skill 落盘 skills/<name>/SKILL.md
  // 与 refine() (失败→经验) 互补, 形成「失败学教训 + 成功沉淀技能」完整闭环
  async refineSkill({ limit = 50, minFreq = 2 } = {}) {
    if (!this.llm) return { created: 0, reason: "无 LLM" };
    const ok = this.traces.read(undefined, limit).filter((t) => t.ok);
    if (ok.length < minFreq) return { created: 0, reason: "成功轨迹不足" };
    // 找高频成功工具 (出现 >= minFreq 次)
    const freq = {};
    for (const t of ok) freq[t.tool] = (freq[t.tool] || 0) + 1;
    const hot = Object.entries(freq).filter(([, n]) => n >= minFreq).map(([t]) => t);
    if (!hot.length) return { created: 0, reason: "无重复成功工具模式" };
    // 用 LLM 提炼 skill (name/description/content)
    const summary = ok.slice(-20).map((t) => `工具 ${t.tool}: ${String(t.result || "").slice(0, 80)}`).join("\n");
    let skill;
    try {
      const r = await this.llm.chat([
        { role: "system", content: "你是技能提炼器。根据成功的工具调用轨迹, 提炼一个可复用技能。只输出 JSON: {\"name\":\"技能名(仅字母数字横线)\",\"description\":\"一句话说明\",\"content\":\"SKILL正文, 含 ## 流程(逐步工作流) 和 ## 验证(完成后必须提供的证据)\"}。不要解释, 只输出 JSON。" },
        { role: "user", content: `高频工具: ${hot.join(", ")}\n成功轨迹:\n${summary.slice(0, 2000)}` },
      ]);
      const text = String(r.content || "").trim().replace(/```(?:json|JSON)?\s*/g, "").replace(/```/g, "").trim();
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return { created: 0, reason: "LLM 未产出有效 JSON" };
      skill = JSON.parse(m[0]);
    } catch { return { created: 0, reason: "LLM 提炼失败" }; }
    if (!skill || !skill.content) return { created: 0, reason: "Skill 字段缺失" };
    // name 归一化: 仅字母/数字/横线, 非法字符剔除, 空则兜底
    const name = String(skill.name || "").replace(/[^a-zA-Z0-9-]/g, "").toLowerCase() || ("auto-" + Date.now().toString(36));
    const res = await this.tools.call("create_skill", {
      name,
      description: String(skill.description || "自动提炼的技能"),
      content: String(skill.content),
    }, { agent: this });
    if (res.startsWith(TOOL_ERROR_PREFIX)) return { created: 0, reason: res };
    info(`[refineSkill] 生成技能: ${name}`);
    return { created: 1, name };
  }


  // 把新记忆归档进 L2 场景
  _archiveScenes() {
    const recent = this.facts.query("", { limit: 5 });
    for (const f of recent) {
      if (!this.scenes.findByFactId(f.id)) this.scenes.assign(f);
    }
  }

  // 可观测: 聚合各层状态 (记忆 L0-L3 / 轨迹 / 工具 / 经验 / 自愈)
  // 顶层展平 traces.stats() 字段 (count/failed/failRate/slowTools), 向后兼容 web 前端
  stats() {
    const sessions = this.sessionStore ? this.sessionStore.list() : [];
    const eventsTotal = sessions.reduce((a, s) => a + (s.count || 0), 0);
    const tools = this.tools ? this.tools.listDetailed() : [];
    return {
      ...(this.traces && typeof this.traces.stats === "function" ? this.traces.stats() : {}),
      agent: {
        name: this.config.agent?.name || "ppx",
        mode: this.config.agent?.mode || "react",
        llm: this.llm ? (this.llm.backend || this.llm.model || "configured") : "none",
      },
      memory: {
        l0: { events_total: eventsTotal, sessions: sessions.length },
        l1: this.facts && this.facts.stats ? this.facts.stats() : {},
        l2: this.scenes && this.scenes.count ? { scenes: this.scenes.count() } : {},
        l3: this.personaStore && this.personaStore.stats ? this.personaStore.stats() : {},
        ...(this.memory && this.memory.stats ? this.memory.stats() : {}),
      },
      tools: { total: tools.length, enabled: tools.filter((t) => t.enabled).length },
      experience: this.experience ? { lessons: this.experience.lessons.length } : {},
      health: this.health || null,
    };
  }

  // 接入 MCP 服务器: 连接 + 注册工具到 catalog (可选能力, 显式调用)
  // servers 缺省用 config.mcp.servers; 返回注册的工具数
  async connectMcp(servers = null) {
    const list = servers || (this.config.mcp && this.config.mcp.servers) || [];
    if (!list.length) return 0;
    const r = await registerMcpTools(this.tools, list);
    this._mcp = r;
    return r.count;
  }

  // 热重载提供方: 从 config/ppx.json 重建 LLM 客户端列表
  // 用法: HTTP API 增删改提供方后调用, 立即生效无需重启
  reloadProviders() {
    this.config = this._loadConfig(null);
    this.llm = this._resolveSingleLLM(this.config);
    this.allProviders = this._resolveAllLLMs(this.config);
    info(`[providers] 热重载完成: ${this.allProviders.length} 个客户端`);
    return { llm: this.llm ? (this.llm.backend || this.llm.model) : null, count: this.allProviders.length };
  }

  // 与 plugin/builtin.js 的同名纯函数保持一致; 这里复制一份避免循环依赖 (agent 已被 plugin 依赖)
  _isUsableProvider(prov) {
    const key = prov.api_key || process.env[prov.api_key_env];
    const isLocal = /127\.0\.0\.1|localhost|lm-studio|ollama/i.test(prov.base_url || "");
    const isOpenclaw = prov.backend === "openclaw" || prov.id === "openclaw";
    const isDeepseek = prov.backend === "deepseek" || prov.backend === "dsh" || prov.id === "dsh";
    return !!(key || isLocal || isOpenclaw || isDeepseek);
  }
  _resolveSingleLLM(config) {
    const p = (config.providers || []).find((x) => this._isUsableProvider(x));
    return p ? new LLMClient(p) : null;
  }
  _resolveAllLLMs(config) {
    return (config.providers || []).filter((x) => this._isUsableProvider(x)).map((p) => new LLMClient(p));
  }

  shutdown() {
    this._mcp?.close?.();
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
