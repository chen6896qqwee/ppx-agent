// src/memory/session.js - 会话持久化 (JSONL 落盘)
// 每个 sessionKey 一个文件 data/sessions/<key>.jsonl, 内存 Map 与文件双写
// 解决: 原来会话只在内存 Map, 重启即丢
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../utils/store.js";

export class SessionStore {
  constructor(dataDir) {
    this.dir = path.join(dataDir, "sessions");
    ensureDir(this.dir);
    this.cache = new Map(); // sessionKey -> [{role,content}]
    this._loadAll();
  }

  _file(key) {
    // 清洗 sessionKey, 防路径穿越
    const safe = String(key || "default").replace(/[^\w.-]/g, "_");
    return path.join(this.dir, `${safe}.jsonl`);
  }

  _loadAll() {
    let files = [];
    try { files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".jsonl")); } catch { return; }
    for (const f of files) {
      const key = f.replace(/\.jsonl$/, "");
      const lines = [];
      try {
        const raw = fs.readFileSync(path.join(this.dir, f), "utf8").split("\n").filter(Boolean);
        for (const l of raw) { try { lines.push(JSON.parse(l)); } catch {} }
      } catch {}
      this.cache.set(key, lines);
    }
  }

  get(key) {
    const k = String(key || "default");
    if (!this.cache.has(k)) this.cache.set(k, []);
    return this.cache.get(k);
  }

  set(key, history) {
    const k = String(key || "default");
    this.cache.set(k, history);
    this._flush(k);
  }

  delete(key) {
    const k = String(key || "default");
    this.cache.delete(k);
    try { fs.rmSync(this._file(k), { force: true }); } catch {}
  }

  has(key) { return this.cache.has(String(key || "default")); }

  _flush(key) {
    try {
      const hist = this.cache.get(key) || [];
      fs.writeFileSync(this._file(key), hist.map((m) => JSON.stringify(m)).join("\n") + (hist.length ? "\n" : ""), "utf8");
    } catch {}
  }
}
