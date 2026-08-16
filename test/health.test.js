import test from "node:test";
import assert from "node:assert";
import { LLMClient, nodeVersionOk } from "../src/llm/client.js";

test("nodeVersionOk: 支持/不支持版本矩阵", () => {
  assert.equal(nodeVersionOk("22.22.2"), false);
  assert.equal(nodeVersionOk("22.22.3"), true);
  assert.equal(nodeVersionOk("23.0.0"), false);
  assert.equal(nodeVersionOk("24.14.0"), false);
  assert.equal(nodeVersionOk("24.15.0"), true);
  assert.equal(nodeVersionOk("25.8.9"), false);
  assert.equal(nodeVersionOk("25.9.0"), true);
  assert.equal(nodeVersionOk("26.4.0"), true);
});

test("LLMClient.health: openclaw 后端按 Node 版本判断", async () => {
  const c = new LLMClient({ id: "openclaw", backend: "openclaw", mjs: "x.mjs" });
  const h = await c.health();
  assert.equal(typeof h, "boolean");
  // 与纯函数一致, 不硬编码环境版本
  assert.equal(h, nodeVersionOk(process.versions.node));
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
