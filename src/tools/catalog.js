// src/tools/catalog.js - 工具注册表 (参考 openhanako tool-catalog)
// 统一管理所有工具: 定义 + schema + 执行函数
import { info } from "../utils/logger.js";

export class ToolCatalog {
  constructor() {
    this.tools = new Map();
  }

  // 注册一个工具
  register(def) {
    if (!def.name || typeof def.execute !== "function") {
      throw new Error(`工具注册失败: 需 name + execute (got ${def.name})`);
    }
    this.tools.set(def.name, {
      name: def.name,
      description: def.description || "",
      parameters: def.parameters || { type: "object", properties: {}, required: [] },
      execute: def.execute,
    });
    return this;
  }

  // OpenAI 兼容的 tools 格式 (给 LLM 用)
  toOpenAI() {
    return [...this.tools.values()].map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  // 执行工具调用
  async call(name, args, ctx = {}) {
    const tool = this.tools.get(name);
    if (!tool) {
      return JSON.stringify({ error: `未知工具: ${name}` });
    }
    try {
      info(`tool: ${name}(${JSON.stringify(args)})`);
      const result = await tool.execute(args, ctx);
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch (e) {
      return JSON.stringify({ error: `${name} 执行失败: ${e.message}` });
    }
  }

  has(name) {
    return this.tools.has(name);
  }

  list() {
    return [...this.tools.keys()];
  }
}