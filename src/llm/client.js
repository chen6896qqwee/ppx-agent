// src/llm/client.js - OpenAI 兼容 LLM 客户端 (零依赖, 用 fetch)
import { info, warn, error } from "../utils/logger.js";

export class LLMClient {
  constructor(provider) {
    this.baseUrl = (provider.base_url || "").replace(/\/$/, "");
    this.apiKey = provider.api_key || process.env[provider.api_key_env] || "";
    this.model = provider.model || provider.models?.chat || "gpt-4o-mini";
    this.timeoutMs = provider.timeout_ms || 120000;
  }

  // 原生 chat (无工具)
  async chat(messages, { temperature = 0.7, maxTokens = 2048 } = {}) {
    const data = await this._request("/chat/completions", { model: this.model, messages, temperature, max_tokens: maxTokens });
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM 返回空内容");
    return { content, usage: data?.usage };
  }

  // API chat (支持工具调用), 返回完整 message (含 tool_calls)
  async apiChat(messages, { tools = [], temperature = 0.7, maxTokens = 4096 } = {}) {
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
}