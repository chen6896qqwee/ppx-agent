// test/session.test.js - 会话持久化 (重启不丢)
import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { PPXAgent } from "../src/agent/index.js";

function tmpRoot(n){ return fs.mkdtempSync(path.join(os.tmpdir(), `ppx-${n}-`)); }

test("会话写入后可跨实例恢复 (持久化)", () => {
  const root = tmpRoot("ses");
  const a = new PPXAgent({ root });
  a._pushTurn("k1", "你好", "在的兄弟");
  a._pushTurn("k1", "记住", "好的");
  a.resetSession("tmp"); // 不存在的 key, 应安全
  a.shutdown();

  // 模拟重启: 新 agent 同 root
  const b = new PPXAgent({ root });
  const hist = b._loadHistory("k1");
  assert.ok(hist.length >= 4, "恢复 4 条, got " + hist.length);
  assert.ok(hist.some((m) => m.content === "记住"), "内容正确");
  b.shutdown();
});

test("resetSession 同时清除磁盘文件", () => {
  const root = tmpRoot("ses");
  const a = new PPXAgent({ root });
  a._pushTurn("k2", "x", "y");
  assert.ok(a.sessionStore.has("k2"), "写入后存在");
  a.resetSession("k2");
  assert.ok(!a.sessionStore.has("k2"), "重置后清除");
  a.shutdown();
});
