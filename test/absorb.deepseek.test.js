// test/absorb.deepseek.test.js - deepseek-harness 架构吸收验证
// 能力缝(元数据/Consumer策略/热挂载) + skill loader + selfmod 工具
import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ToolCatalog, registerSelfmodTools, TOOL_ERROR_PREFIX } from "../src/tools/index.js";
import { SkillLoader } from "../src/skills/loader.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = path.join(ROOT, "skills");

test("能力缝: 元数据默认值(category/power/timeout/enabled)", () => {
  const c = new ToolCatalog();
  c.register({ name: "t1", execute: async () => "ok" });
  c.register({ name: "t2", category: "net", power: "super", timeoutMs: 500, idempotent: true, execute: async () => "ok" });
  const d = c.listDetailed();
  const t1 = d.find((x) => x.name === "t1");
  assert.equal(t1.category, "misc");
  assert.equal(t1.power, "user");
  assert.equal(t1.timeoutMs, 0);
  assert.equal(t1.idempotent, false);
  assert.equal(t1.enabled, true);
  const t2 = d.find((x) => x.name === "t2");
  assert.equal(t2.category, "net");
  assert.equal(t2.power, "super");
  assert.equal(t2.timeoutMs, 500);
  assert.equal(t2.idempotent, true);
});

test("能力缝: Consumer 禁用门禁", async () => {
  const c = new ToolCatalog();
  c.register({ name: "t", execute: async () => "ran" });
  assert.equal(await c.call("t", {}), "ran");
  assert.equal(c.disable("t"), true);
  const res = await c.call("t", {});
  assert.ok(res.includes("已禁用"), "禁用后调用应被拒");
  // toOpenAI 不含禁用项
  assert.ok(!c.toOpenAI().some((x) => x.function.name === "t"));
  assert.equal(c.enable("t"), true);
  assert.equal(await c.call("t", {}), "ran");
});

test("能力缝: Consumer 超时门禁", async () => {
  const c = new ToolCatalog();
  c.register({ name: "slow", timeoutMs: 30, execute: () => new Promise((r) => setTimeout(() => r("done"), 200)) });
  const res = await c.call("slow", {});
  assert.ok(res.includes("超时"), "超时应报超时错误, got: " + res);
});

test("能力缝: Consumer 统一错误语义", async () => {
  const c = new ToolCatalog();
  c.register({ name: "boom", execute: async () => { throw new Error("炸了"); } });
  const res = await c.call("boom", {});
  assert.ok(res.startsWith(TOOL_ERROR_PREFIX), "错误带统一前缀");
  assert.ok(res.includes("炸了"));
  // 未知工具
  const mk = await c.call("nope", {});
  assert.ok(mk.includes("未知工具"));
  // 无实现(Provider 缺失)
  const c2 = new ToolCatalog();
  c2.register({ name: "ghost", execute: async () => "x" });
  c2.tools.get("ghost").execute = undefined;
  const ghost = await c2.call("ghost", {});
  assert.ok(ghost.includes("无实现"), "Provider 缺失应报错");
});


test("能力缝: power 权限门禁", async () => {
  const c = new ToolCatalog();
  c.register({ name: "admin", power: "super", execute: async (a) => "secret" });
  // 无 ctx.power 默认放行(向后兼容)
  assert.equal(await c.call("admin", {}), "secret");
  // user 权限不足
  const low = await c.call("admin", {}, { power: "user" });
  assert.ok(low.includes("权限不足"), "user 访问 super 应拒绝, got: " + low);
  // agent 仍不足
  const mid = await c.call("admin", {}, { power: "agent" });
  assert.ok(mid.includes("权限不足"));
  // super 放行
  assert.equal(await c.call("admin", {}, { power: "super" }), "secret");
});

test("能力缝: 热挂载 unregister", () => {
  const c = new ToolCatalog();
  c.register({ name: "t", execute: async () => 1 });
  assert.ok(c.has("t"));
  assert.equal(c.unregister("t"), true);
  assert.ok(!c.has("t"));
  assert.equal(c.unregister("t"), false);
});

test("skill loader: 枚举 skills 目录", () => {
  const l = new SkillLoader(SKILLS);
  const list = l.list();
  assert.ok(list.length >= 3, "至少枚举出 ppx-memory/ppx-selfheal/ponytail, got " + list.length);
  const mem = l.get("ppx-memory");
  assert.ok(mem, "ppx-memory 可发现");
  assert.ok(mem.name && mem.description, "解析出 name/description");
  assert.ok(l.has("ppx-selfheal"));
  assert.equal(l.get("nope"), null);
  const content = l.read("ppx-memory");
  assert.ok(content && content.includes("ppx-memory"));
});

test("selfmod: list_capabilities 枚举工具+技能", async () => {
  const c = new ToolCatalog();
  registerSelfmodTools(c, { skillsDir: SKILLS });
  const res = await c.call("list_capabilities", {});
  assert.ok(res.includes("工具"));
  assert.ok(res.includes("list_capabilities"));
  assert.ok(res.includes("技能"));
  assert.ok(res.includes("ppx-memory"), "技能被枚举");
});

test("selfmod: enable/disable/load_skill 全链路", async () => {
  const c = new ToolCatalog();
  registerSelfmodTools(c, { skillsDir: SKILLS });
  // 禁用某工具, selfmod 再启用
  assert.equal(c.disable("load_skill"), true);
  const d1 = await c.call("list_capabilities", { kind: "tool" });
  assert.ok(d1.includes("[OFF] load_skill"), "禁用状态可见");
  assert.equal(await c.call("enable_capability", { name: "load_skill" }), "已启用: load_skill");
  // load_skill 读取技能
  const loaded = await c.call("load_skill", { id: "ppx-memory" });
  assert.ok(loaded.includes("ppx-memory"));
  // 未知技能
  const bad = await c.call("load_skill", { id: "nope" });
  assert.ok(bad.includes("未知技能"));
  // 禁用后调用被拒
  await c.call("disable_capability", { name: "load_skill" });
  const off = await c.call("load_skill", { id: "ppx-memory" });
  assert.ok(off.includes("已禁用"));
});
