// src/memory/session.js - 会话事件日志 (吸收 dsh "会话即唯一事实源")
// 新架构: 不可变 append-only 事件日志, 每条 = {seq, ts, type, data}
//  - 模型可见历史 = deriveMessages() 从日志投影 (无可变状态, 仅从日志重建)
//  - replay() 回放完整事件流 | fork() 从边界派生新会话
//  - 兼容旧 get/set/has/delete 接口 (agent 无需全量改动)
// 吸收自 DeepSeek Harness: "model-visible means logged" (能进模型的必须能从日志重建)
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../utils/store.js";

// 事件类型集 (对齐 dsh 事件域: user/assistant/tool/system)
export const EVENTS = {
  USER: "user/message",
  ASSISTANT: "assistant/message",
  SYSTEM: "system",
  TOOL_CALL: "tool/call",
  TOOL_RESULT: "tool/result",
};

export class SessionStore {
  constructor(dataDir) {
    this.dir = path.join(dataDir, "sessions");
    ensureDir(this.dir);
    this._logs = new Map();    // key -> event[] (不可变, append-only)
    this._nextSeq = new Map(); // key -> 下一个 seq
    this._loadAll();
  }

  _safe(key) { return String(key || "default").replace(/[^\w.-]/g, "_"); }
  _file(key) { return path.join(this.dir, this._safe(key) + ".jsonl"); }

  _log(key) {
    const k = this._safe(key);
    if (!this._logs.has(k)) { this._logs.set(k, []); this._nextSeq.set(k, 0); }
    return this._logs.get(k);
  }

  _loadAll() {
    let files = [];
    try { files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".jsonl")); } catch { return; }
    for (const f of files) {
      const k = f.replace(/\.jsonl$/, "");
      const events = [];
      try {
        for (const l of fs.readFileSync(path.join(this.dir, f), "utf8").split("\n").filter(Boolean)) {
          try { const e = JSON.parse(l); if (e && e.seq && e.type && e.data) events.push(e); } catch {}
        }
      } catch {}
      if (events.length) {
        events.sort((a, b) => a.seq - b.seq);
        this._logs.set(k, events);
        this._nextSeq.set(k, events[events.length - 1].seq);
      }
    }
  }

  // 追加事件 (唯一写入路径, append-only, 永不重写/裁剪日志文件)
  append(key, type, data) {
    const k = this._safe(key);
    const seq = (this._nextSeq.get(k) || 0) + 1;
    const ev = { seq, ts: Date.now(), type, data };
    this._log(k).push(ev);
    this._nextSeq.set(k, seq);
    this._flush(k);
    return ev;
  }

  // 从日志投影模型可见历史 (user/assistant), 无可变状态
  deriveMessages(key) {
    return this._log(this._safe(key))
      .filter((e) => e.type === EVENTS.USER || e.type === EVENTS.ASSISTANT)
      .map((e) => ({ role: e.type === EVENTS.USER ? "user" : "assistant", content: e.data?.content }));
  }

  // 完整事件流 (回放/审计/轨迹)
  replay(key) { return [...this._log(this._safe(key))]; }

  // L0 只读代理 / 按天审计: 遍历所有会话, 派生某天的对话事件 (消除 l0/*.jsonl 重复)
  eventsByDay(day) {
    const out = [];
    const dayMs = new Date(String(day).slice(0, 10) + "T00:00:00").getTime();
    if (Number.isNaN(dayMs)) return out;
    const nextMs = dayMs + 86400000;
    for (const [key, events] of this._logs) {
      for (const e of events) {
        if (e.type !== EVENTS.USER && e.type !== EVENTS.ASSISTANT) continue;
        if (e.ts >= dayMs && e.ts < nextMs) {
          out.push({ sessionKey: key, role: e.type === EVENTS.USER ? "user" : "assistant", content: e.data?.content, timestamp: e.ts });
        }
      }
    }
    out.sort((a, b) => a.timestamp - b.timestamp);
    return out;
  }

  // fork: 从 boundarySeq 及更早派生新会话 (吸收 dsh fork 语义, 保留不可变源)
  fork(fromKey, boundarySeq, toKey) {
    const keep = this._log(this._safe(fromKey)).filter((e) => e.seq <= boundarySeq);
    const k = this._safe(toKey);
    this._logs.set(k, [...keep]);
    this._nextSeq.set(k, keep.length ? keep[keep.length - 1].seq : 0);
    this._flush(k);
    return keep;
  }

  // count: 事件条数
  count(key) { return this._log(this._safe(key)).length; }

  // ---- 兼容旧接口 (agent/CLI 仍可用) ----
  get(key) { return this.deriveMessages(key); }
  set(key, history) {
    const k = this._safe(key);
    this._logs.delete(k); this._nextSeq.set(k, 0);
    for (const m of (history || [])) this.append(k, m.role === "user" ? EVENTS.USER : EVENTS.ASSISTANT, { content: m.content });
    return history;
  }
  has(key) { return this._logs.has(this._safe(key)); }
  delete(key) {
    const k = this._safe(key);
    this._logs.delete(k); this._nextSeq.delete(k);
    try { fs.rmSync(this._file(k), { force: true }); } catch {}
  }

  _flush(key) {
    try {
      const evs = this._logs.get(this._safe(key)) || [];
      fs.writeFileSync(this._file(key), evs.map((e) => JSON.stringify(e)).join("\n") + (evs.length ? "\n" : ""), "utf8");
    } catch {}
  }
}
