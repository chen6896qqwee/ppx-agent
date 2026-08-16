import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "../src/memory/session.js";

function tmp(){ return fs.mkdtempSync(path.join(os.tmpdir(),"ppx-sessm-")); }

test("P1#6: SessionStore.list 列出多会话含标题", async () => {
  const s = new SessionStore(tmp());
  s.append("a", "user/message", { content: "第一句话很长很长要截断" });
  s.append("a", "assistant/message", { content: "回复1" });
  await new Promise((r) => setTimeout(r, 5)); // 制造时间差, 保证 lastTs 可排序
  s.append("b", "user/message", { content: "另一个会话" });
  const list = s.list();
  assert.equal(list.length, 2);
  const a = list.find((x) => x.key === "a");
  assert.equal(a.count, 2);
  assert.equal(a.title, "第一句话很长很长要截断".slice(0, 20));
  // 默认按 lastTs 倒序, b 更新, 应在 a 前
  assert.equal(list[0].key, "b");
});

test("P1#6: SessionStore.rename 复制并删旧", () => {
  const s = new SessionStore(tmp());
  s.append("old", "user/message", { content: "hi" });
  assert.equal(s.rename("old", "new"), true);
  assert.equal(s.has("new"), true);
  assert.equal(s.has("old"), false);
  assert.deepEqual(s.deriveMessages("new").map((m) => m.content), ["hi"]);
  // 重命名不存在的返回 false
  assert.equal(s.rename("nonexist", "x"), false);
});

test("P1#6: SessionStore.delete 移除", () => {
  const s = new SessionStore(tmp());
  s.append("k", "user/message", { content: "x" });
  assert.equal(s.has("k"), true);
  s.delete("k");
  assert.equal(s.has("k"), false);
});
