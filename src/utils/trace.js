// src/utils/trace.js - 结构化可观测轨迹 (Harness 第四层)
// 记录每次工具调用的完整轨迹: 工具/参数/结果摘要/耗时/成败
// 写 JSONL 到 data/logs/traces/YYYY-MM-DD.jsonl, 供事后复盘"哪一步坏了"
import fs from "node:fs";
import path from "node:path";
import { ensureDir, logicalDay } from "./store.js";

const MAX_TRACE_BODY = 2000;   // 单条结果保留上限, 防爆文件

export class Traces {
  constructor(dataDir) {
    this.dir = path.join(dataDir, "logs", "traces");
    ensureDir(this.dir);
    this.sessionId = "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.count = 0;
  }

  _file() { return path.join(this.dir, `${logicalDay()}.jsonl`); }

  // 记录一次工具调用轨迹
  record({ tool, args, result, ok, durationMs, error }) {
    this.count += 1;
    const entry = {
      ts: new Date().toISOString(),
      sessionId: this.sessionId,
      seq: this.count,
      tool,
      args: this._truncate(JSON.stringify(args ?? {})),
      result: this._truncate(result),
      ok: !!ok,
      durationMs: Math.round(durationMs || 0),
      error: error || null,
    };
    fs.appendFileSync(this._file(), JSON.stringify(entry) + "\n", "utf8");
    return entry;
  }

  _truncate(s) {
    const str = String(s ?? "");
    return str.length > MAX_TRACE_BODY ? str.slice(0, MAX_TRACE_BODY) + "…" : str;
  }

  // 读取某天轨迹 (最近 N 条)
  read(day = logicalDay(), limit = 100) {
    const file = this._file();
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-limit)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  // 统计: 失败率/平均耗时/慢工具
  stats(day = logicalDay()) {
    const all = this.read(day, 10000);
    if (!all.length) return { count: 0, failed: 0, failRate: "0%", slowTools: [] };
    const failed = all.filter((t) => !t.ok);
    const byTool = {};
    for (const t of all) {
      (byTool[t.tool] = byTool[t.tool] || { calls: 0, fails: 0, totalMs: 0 });
      byTool[t.tool].calls++;
      if (!t.ok) byTool[t.tool].fails++;
      byTool[t.tool].totalMs += t.durationMs;
    }
    const slow = Object.entries(byTool)
      .map(([tool, v]) => ({ tool, ...v, avgMs: Math.round(v.totalMs / v.calls) }))
      .sort((a, b) => b.avgMs - a.avgMs).slice(0, 5);
    return {
      count: all.length,
      failed: failed.length,
      failRate: all.length ? (failed.length / all.length * 100).toFixed(1) + "%" : "0%",
      slowTools: slow,
    };
  }
}
