import test from "node:test";
import assert from "node:assert";
import { LLMClient } from "../src/llm/client.js";

test("LLMClient.health: openclaw 后端按 Node 版本判断", async () => {
  const c = new LLMClient({ id: "openclaw", backend: "openclaw", mjs: "x.mjs" });
  const h = await c.health();
  assert.equal(typeof h, "boolean");
  // 当前 Node v26 满足 >=25.9
  assert.equal(h, true, "当前 Node 应满足 openclaw 要求");
});

test("LLMClient.health: http 后端无 key 返回 false", async () => {
  const c = new LLMClient({ id: "http", base_url: "https://api.openai.com/v1", api_key_env: "OPENAI_API_KEY" });
  const h = await c.health();
  assert.equal(h, false, "无 API key 不可用");
});

test("LLMClient.health: http 后端有 key 时探测 /models", async () => {
  const c = new LLMClient({ id: "http", base_url: "https://api.openai.com/v1", api_key: "sk-test" });
  const h = await c.health();
  assert.equal(typeof h, "boolean");
});
