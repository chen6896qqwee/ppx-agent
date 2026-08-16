// src/llm/client.js - LLM 客户端
// 后端两种模式:
//   backend="openclaw" : 通过 `openclaw agent` CLI 驱动 OpenClaw 引擎 (底座=OpenClaw)
//   backend="http"     : 直接 OpenAI 兼容 HTTP API (零依赖, 用 fetch)  [默认]
import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { info, warn, error } from "../utils/logger.js";

const DEFAULT_DSH_ROOT = process.env.PPX_DSH_ROOT || "C:/Users/chen/Desktop/deepseek-harness";
const DEFAULT_MJS = process.env.PPX_OPENCLAW_MJS || "C:/Users/chen/AppData/Roaming/npm/node_modules/openclaw/openclaw.mjs";

// 纯函数: 校验 Node 版本是否满足 OpenClaw 引擎要求 (>=22.22.3 / >=24.15 / >=25.9, 且 23 与 24.0-24.14 不支持)
export function nodeVersionOk(version) {
  const v = String(version).split(".").map(Number);
  const [maj, min, pat] = v;
  return (maj === 22 && (min > 22 || (min === 22 && pat >= 3))) ||
         (maj === 24 && min >= 15) ||
         (maj === 25 && min >= 9) || maj > 25;
}
export class LLMClient {
  constructor(provider) {
    this.providerId = provider.id || "openclaw";
    // 后端选择: 显式 backend=openclaw, 或 id=openclaw
    this.backend = provider.backend === "openclaw" || provider.id === "openclaw" ? "openclaw"
      : provider.backend === "deepseek" || provider.backend === "dsh" || provider.id === "dsh" ? "deepseek"
      : "http";
    this.baseUrl = (provider.base_url || "").replace(/\/$/, "");
    this.apiKey = provider.api_key || process.env[provider.api_key_env] || "";
    this.model = provider.model || provider.models?.chat || "gpt-4o-mini";
    this.timeoutMs = provider.timeout_ms || 120000;
    // openclaw 后端专用
    this.mjs = provider.mjs || DEFAULT_MJS;
    this.sessionKey = provider.session_key || "ppx:main";
    this.dshRoot = provider.dsh_root || DEFAULT_DSH_ROOT;
    this._tmpCounter = 0;
    if (this.backend === "openclaw") info(`LLMClient[${this.providerId}] backend=openclaw mjs=${this.mjs} session=${this.sessionKey}`);
  }

  // ===== OpenClaw 后端异步版 (async spawn, 不阻塞事件循环) ====
  async _openclawChatAsync(messages) {
    this._openclawReadyOrThrow();
    const lastUser = [...messages].reverse().find(m => m && (m.role === "user"));
    const text = lastUser?.content || "";
    const tmp = path.join(os.tmpdir(), `ppx_msg_${Date.now()}_${this._tmpCounter++}.txt`);
    fs.writeFileSync(tmp, String(text), "utf8");
    try {
      const args = [
        this.mjs, "agent",
        "--session-key", this.sessionKey,
        "--message-file", tmp,
        "--json",
        "--timeout", String(Math.floor(this.timeoutMs / 1000)),
      ];
      const stdout = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
        let out = "", err = "";
        child.stdout.on("data", d => out += d);
        child.stderr.on("data", d => err += d);
        child.on("error", reject);
        child.on("close", code => {
          if (code !== 0) reject(this._translateOpenclawError(new Error(`openclaw 退出 code=${code}: ${err.slice(-500)}`)));
          else resolve(out);
        });
      });
      const j = JSON.parse(stdout);
      if (j.status && j.status !== "ok") throw new Error(`OpenClaw run status=${j.status}`);
      const payloads = j?.result?.payloads || [];
      const content = payloads.map(p => p?.text || "").filter(Boolean).join("\n");
      if (!content) {
        const alt = j?.result?.meta?.finalAssistantVisibleText;
        if (alt) return { content: alt, usage: null };
        throw new Error("OpenClaw 返回空内容");
      }
      return { content, usage: null, meta: { engine: "openclaw", runId: j.runId } };
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch {}
    }
  }

  // ===== OpenClaw 后端: 写临时 UTF-8 消息文件 -> openclaw agent --json -> 提取 payloads[].text ====
  _openclawChat(messages) {
    this._openclawReadyOrThrow();
    const lastUser = [...messages].reverse().find(m => m && (m.role === "user"));
    const text = lastUser?.content || "";
    const tmp = path.join(os.tmpdir(), `ppx_msg_${Date.now()}_${this._tmpCounter++}.txt`);
    fs.writeFileSync(tmp, String(text), "utf8");
    try {
      const args = [
        this.mjs,
        "agent",
        "--session-key", this.sessionKey,
        "--message-file", tmp,
        "--json",
        "--timeout", String(Math.floor(this.timeoutMs / 1000)),
      ];
      let stdout;
      try {
        stdout = execFileSync(process.execPath, args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024, timeout: this.timeoutMs + 15000 });
      } catch (e) {
        throw this._translateOpenclawError(e);
      }
      const j = JSON.parse(stdout);
      if (j.status && j.status !== "ok") throw new Error(`OpenClaw run status=${j.status}`);
      const payloads = j?.result?.payloads || [];
      const content = payloads.map(p => p?.text || "").filter(Boolean).join("\n");
      if (!content) {
        const alt = j?.result?.meta?.finalAssistantVisibleText;
        if (alt) return { content: alt, usage: null };
        throw new Error("OpenClaw 返回空内容");
      }
      return { content, usage: null, meta: { engine: "openclaw", runId: j.runId } };
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch {}
    }
  }

  // ===== DeepSeek Harness 后端 (dsh headless 一次性运行器) ====
  _dshReadyOrThrow() {
    if (!fs.existsSync(path.join(this.dshRoot, "apps/cli/src/bin.ts"))) {
      throw new Error("[皮皮虾] dsh 源码未就绪: " + this.dshRoot + "/apps/cli/src/bin.ts 不存在。\n请先 git clone deepseek-harness 并在其目录 pnpm install。");
    }
  }

  // 驱动 `node --import tsx/esm apps/cli/src/bin.ts --profile headless "<task>"`,
  // stdout = 最终助手文本, exit 0 = turn 完成, 1 = 出错(stderr 带错误)
  async _dshChatAsync(messages) {
    this._dshReadyOrThrow();
    const lastUser = [...messages].reverse().find(m => m && m.role === "user");
    const text = lastUser?.content || "";
    const args = ["--import", "tsx/esm", "apps/cli/src/bin.ts", "--profile", "headless", text];
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: this.dshRoot, stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout.on("data", d => out += d);
      child.stderr.on("data", d => err += d);
      child.on("error", reject);
      child.on("close", code => {
        if (code !== 0) reject(new Error(`dsh 退出 code=${code}: ${err.slice(-500)}`));
        else resolve(out);
      });
    });
    const content = stdout.trim();
    if (!content) throw new Error("dsh 返回空内容");
    return { content, usage: null, meta: { engine: "deepseek-harness" } };
  }

  // 原生 chat (无工具)
  async chat(messages, { temperature = 0.7, maxTokens = 2048 } = {}) {
    if (this.backend === "openclaw") {
      const r = await this._openclawChatAsync(messages);
      return { content: r.content, usage: r.usage };
    }
    if (this.backend === "deepseek") {
      const r = await this._dshChatAsync(messages);
      return { content: r.content, usage: r.usage };
    }
    const data = await this._request("/chat/completions", { model: this.model, messages, temperature, max_tokens: maxTokens });
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM 返回空内容");
    return { content, usage: data?.usage };
  }

  // API chat (支持工具调用), 返回完整 message (含 tool_calls)
  async apiChat(messages, { tools = [], temperature = 0.7, maxTokens = 4096 } = {}) {
    if (this.backend === "openclaw") {
      // OpenClaw 引擎自己处理工具循环; 这里把引擎当纯 LLM, 不返回 tool_calls
      const r = await this._openclawChatAsync(messages);
      return { message: { role: "assistant", content: r.content, tool_calls: null }, usage: r.usage };
    }
    if (this.backend === "deepseek") {
      // dsh 引擎自己处理工具循环; 这里把引擎当纯 LLM, 不返回 tool_calls
      const r = await this._dshChatAsync(messages);
      return { message: { role: "assistant", content: r.content, tool_calls: null }, usage: r.usage };
    }
    const body = { model: this.model, messages, temperature, max_tokens: maxTokens };
    if (tools.length) body.tools = tools;
    const data = await this._request("/chat/completions", body);
    const message = data?.choices?.[0]?.message;
    if (!message) throw new Error("LLM 返回空 message");
    return {
      message: {
        role: message.role || "assistant",
        content: message.content || null,
        tool_calls: message.tool_calls || null,
      },
      usage: data?.usage,
    };
  }

  async _request(path, jsonBody) {
    if (!this.apiKey) throw new Error(`LLMClient: 缺少 API key (env=${this.apiKeyEnv() || "?"})`);
    const url = `${this.baseUrl}${path}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.apiKey}` },
        body: JSON.stringify(jsonBody),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`LLM HTTP ${resp.status}: ${text.slice(0, 300)}`);
      }
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  }

  apiKeyEnv() {
    return undefined;
  }

  // openclaw 后端: 启动前校验 Node 版本, 不满足则抛中文引导错误 (而非原始报错)
  _openclawReadyOrThrow() {
    if (!nodeVersionOk(process.versions.node)) {
      throw new Error("[皮皮虾] 当前 Node v" + process.versions.node + " 不满足 OpenClaw 引擎要求。\n请升级 Node 至 >=22.22.3 (推荐 26.x)；注意 Node 23 与 24.0-24.14 不支持。\n或改用 http 后端配置 API key 直连。");
    }
  }

  // 翻译 openclaw CLI 的版本类报错为中文引导
  _translateOpenclawError(e) {
    const msg = String((e && e.message) || e);
    if (/Node\.js >= \d+\.\d+\.\d+/.test(msg) || /engines|不满足引擎要求/.test(msg)) {
      return new Error("[皮皮虾] OpenClaw 引擎要求更高的 Node 版本，请升级 Node 至 >=22.22.3 (推荐 26.x) 后重试。原始信息: " + msg.slice(0, 200));
    }
    return e;
  }
  // ===== Provider 健康探测 (Harness 化: 并发探测可用性, 支持快速失败) =====
  // openclaw 后端: 校验本地 Node 版本是否满足引擎要求 (>=22.22.3 / >=24.15 / >=25.9)
  // http 后端: 快速探测 /models (3s 超时), 不发完整请求
  async health() {
    if (this.backend === "openclaw") {
      const ok = nodeVersionOk(process.versions.node);
      if (!ok) info("[health] openclaw 不可用: Node v" + process.versions.node + " 不满足引擎要求");
      return ok;
    }
    if (this.backend === "deepseek") {
      const okRoot = fs.existsSync(path.join(this.dshRoot, "apps/cli/src/bin.ts"));
      if (!okRoot) info("[health] deepseek 不可用: dsh 源码缺失 " + this.dshRoot);
      return okRoot && nodeVersionOk(process.versions.node);
    }
    if (!this.apiKey) return false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(this.baseUrl + "/models", {
        headers: { "Authorization": "Bearer " + this.apiKey },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      return r.ok;
    } catch (e) {
      warn("[health] " + this.providerId + " 探测失败:", e.message);
      return false;
    }
  }


  // 流式 chat: 逐块回调 (SSE), 返回累积文本
  // onDelta(content) 每次增量, onDone(full) 结束
  async streamChat(messages, { temperature = 0.7, maxTokens = 4096, onDelta, signal } = {}) {
    if (this.backend === "openclaw") {
      // OpenClaw CLI 非流式: 一次性返回全文 (先可用, 后续可切 SSE)
      const r = await this._openclawChatAsync(messages);
      if (onDelta) onDelta(r.content);
      return r.content;
    }
    if (this.backend === "deepseek") {
      // dsh headless 非流式: 一次性返回全文
      const r = await this._dshChatAsync(messages);
      if (onDelta) onDelta(r.content);
      return r.content;
    }
    if (!this.apiKey) throw new Error(`LLMClient: 缺少 API key`);
    const url = `${this.baseUrl}/chat/completions`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const extSig = signal || null;
    if (extSig) extSig.addEventListener("abort", () => ctrl.abort());
    let full = "";
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, messages, temperature, max_tokens: maxTokens, stream: true }),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(`LLM HTTP ${resp.status}: ${txt.slice(0, 300)}`);
      }
      if (!resp.body) { throw new Error("响应无 body, 不支持流式"); }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // 按行解析 SSE
        let idx;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") { done = true; break; }
          try {
            const j = JSON.parse(data);
            const delta = j.choices?.[0]?.delta?.content;
            if (delta) { full += delta; onDelta && onDelta(delta); }
          } catch {}
        }
        if (buf.includes("[DONE]")) break;
      }
      return full;
    } finally {
      clearTimeout(timer);
    }
  }
}
