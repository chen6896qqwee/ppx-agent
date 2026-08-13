// src/tools/advanced.js - 进阶工具集 (搜索 / HTTP / 定时任务)
// 全部零依赖: 用 Node 原生 fetch + timers
import fs from "node:fs";
import path from "node:path";
import { ensureDir, readJson, writeJson } from "../utils/store.js";

// ---------- 网页搜索 (零依赖, 多引擎兜底) ----------
async function searchWeb(query) {
  const q = encodeURIComponent(query);
  const engines = [
    // 1. DuckDuckGo HTML (免key, 结构化)
    async () => {
      const r = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      const html = await r.text();
      const results = [];
      const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g;
      let m;
      while ((m = re.exec(html)) && results.length < 5) {
        const title = m[2].replace(/<[^>]+>/g, "").trim();
        const snippet = m[3].replace(/<[^>]+>/g, "").trim();
        if (title) results.push({ title, url: m[1], snippet });
      }
      if (!results.length) throw new Error("ddg empty");
      return results;
    },
    // 2. DuckDuckGo lite
    async () => {
      const r = await fetch(`https://lite.duckduckgo.com/lite/?q=${q}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const html = await r.text();
      const results = [];
      const re = /<a[^>]+rel="nofollow"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/g;
      return results;
    },
  ];
  let lastErr = null;
  for (const fn of engines) {
    try { const r = await fn(); if (r?.length) return r; } catch (e) { lastErr = e; }
  }
  throw new Error(`所有搜索源失败: ${lastErr?.message || "无结果"}`);
}

// ---------- HTTP 请求 ----------
async function httpRequest({ url, method = "GET", headers = {}, body = null, timeout = 15000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(url, {
      method,
      headers: { "User-Agent": "PPX-Agent/0.2", ...headers },
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
      signal: ctrl.signal,
    });
    const text = await resp.text();
    return { status: resp.status, ok: resp.ok, body: text.slice(0, 20000) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 定时任务 ----------
export class Scheduler {
  constructor(dataDir) {
    this.dir = path.join(dataDir, "scheduler");
    ensureDir(this.dir);
    this.file = path.join(this.dir, "jobs.json");
    this.jobs = readJson(this.file, []);
    this.timers = new Map();
  }

  add({ name, cron, action, type = "once" }) {
    const job = {
      id: "j_" + Math.random().toString(36).slice(2, 8),
      name, cron, action, type, enabled: true, createdAt: new Date().toISOString(),
    };
    this.jobs.push(job);
    writeJson(this.file, this.jobs);
    this._schedule(job);
    return job;
  }

  _schedule(job) {
    if (this.timers.has(job.id)) clearTimeout(this.timers.get(job.id));
    // 简化 cron: 支持 "HH:MM" (每日) 或 "after:Ns" (N秒后)
    let delayMs = null;
    if (typeof job.cron === "string" && job.cron.startsWith("after:")) {
      delayMs = parseInt(job.cron.split(":")[1], 10) * 1000;
    } else if (typeof job.cron === "string" && /^\d{2}:\d{2}$/.test(job.cron)) {
      const [h, m] = job.cron.split(":").map(Number);
      const now = new Date();
      const target = new Date(now); target.setHours(h, m, 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1);
      delayMs = target - now;
    } else if (typeof job.cron === "number") {
      delayMs = job.cron * 1000;
    }
    if (delayMs === null) return;
    const timer = setTimeout(() => this._fire(job), delayMs);
    this.timers.set(job.id, timer);
  }

  async _fire(job) {
    if (job.type === "once") { this.remove(job.id); }
    else { this._schedule(job); } // 每日任务重新排
    try {
      if (typeof job.action === "function") await job.action();
    } catch (e) { console.error("定时任务失败:", e); }
  }

  remove(id) {
    if (this.timers.has(id)) { clearTimeout(this.timers.get(id)); this.timers.delete(id); }
    this.jobs = this.jobs.filter((j) => j.id !== id);
    writeJson(this.file, this.jobs);
  }

  list() { return this.jobs.map(({ id, name, cron, enabled }) => ({ id, name, cron, enabled })); }
}

// 注册进阶工具
export function registerAdvancedTools(catalog, { dataDir, scheduler, onMemoryNote }) {
  catalog.register({
    name: "web_search",
    description: "搜索互联网, 返回网页标题+链接+摘要。",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    execute: async (args) => {
      try {
        const results = await searchWeb(args.query);
        return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || ""}`).join("\n");
      } catch (e) {
        return JSON.stringify({ error: `搜索失败: ${e.message}` });
      }
    },
  });

  catalog.register({
    name: "http_request",
    description: "发送 HTTP 请求 (GET/POST/PUT/DELETE), 返回状态码和响应体。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"] },
        headers: { type: "object" },
        body: { type: "string" },
      },
      required: ["url"],
    },
    execute: async (args) => {
      try {
        const r = await httpRequest(args);
        return JSON.stringify({ status: r.status, ok: r.ok, body: r.body.slice(0, 5000) });
      } catch (e) {
        return JSON.stringify({ error: `HTTP 请求失败: ${e.message}` });
      }
    },
  });

  catalog.register({
    name: "notify",
    description: "Send a proactive notification message to the user channel (use for long-running tasks or async completion alerts).",
    parameters: { type: "object", properties: { message: { type: "string", description: "notification text" } }, required: ["message"] },
    execute: async (args, ctx) => {
      const agent = ctx && ctx.agent;
      if (agent && agent.notify) { agent.notify(args && args.message); return "notified"; }
      return "no notify sink registered";
    },
  });

  catalog.register({
    name: "add_schedule",
    description: "添加定时任务。cron 支持 'HH:MM'(每日) 或 'after:秒数'(N秒后执行一次)。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        cron: { type: "string", description: "'HH:MM' 或 'after:60'" },
      },
      required: ["name", "cron"],
    },
    execute: async (args) => {
      if (!scheduler) return JSON.stringify({ error: "调度器未初始化" });
      const job = scheduler.add({ name: args.name, cron: args.cron, type: /^\d{2}:\d{2}$/.test(args.cron) ? "daily" : "once", action: () => onMemoryNote?.(`定时任务触发: ${args.name}`) });
      return JSON.stringify({ ok: true, id: job.id, next: job.cron });
    },
  });

  catalog.register({
    name: "list_schedules",
    description: "列出所有定时任务。",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      if (!scheduler) return "调度器未初始化";
      return JSON.stringify(scheduler.list());
    },
  });

  return catalog;
}