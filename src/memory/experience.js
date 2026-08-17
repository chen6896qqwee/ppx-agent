// src/memory/experience.js - 经验库 (自学习)
// 从每次任务结果中提炼经验, 供后续任务参考 (参考 openhanako experience)
// 跨 agent 共享: 支持全局经验目录 (globalDataDir), 写入用文件锁防并发覆盖
import path from "node:path";
import { ensureDir, readJson, writeJson, nowISO, withFileLock } from "../utils/store.js";

export class Experience {
  constructor(dataDir) {
    this.dir = path.join(dataDir, "experience");
    ensureDir(this.dir);
    this.file = path.join(this.dir, "lessons.json");
    this.lessons = readJson(this.file, []);
  }

  learn({ task, outcome, lesson, tags = [] }) {
    const entry = {
      id: "e_" + Math.random().toString(36).slice(2, 10),
      task: String(task || "").slice(0, 300),
      outcome: String(outcome || "").slice(0, 300),
      lesson: String(lesson || "").slice(0, 500),
      tags,
      ts: nowISO(),
      uses: 0,
    };
    if (!entry.lesson || entry.lesson.length < 5) return null;
    // 内容去重: 同一 lesson 已存在则命中加分 (uses+1) 而非新增, 防高频学习路径写放大
    // 归一化: 去首尾空白 + 折叠连续空白 (与 FactStore._norm 同策略)
    const normKey = String(lesson).trim().replace(/\s+/g, " ");
    // 锁内读-改-写: 防止多 agent 共享经验库时并发覆盖
    return withFileLock(this.file, () => {
      this.lessons = readJson(this.file, []);
      const existing = this.lessons.find((l) => String(l.lesson || "").trim().replace(/\s+/g, " ") === normKey);
      if (existing) {
        existing.uses += 1;
        existing.ts = nowISO(); // 刷新时间, 让近期命中经验排到 context 前面
        writeJson(this.file, this.lessons);
        return existing;
      }
      this.lessons.push(entry);
      this._prune();
      writeJson(this.file, this.lessons);
      return entry;
    });
  }

  recall(taskDesc) {
    const q = String(taskDesc || "").toLowerCase();
    const scored = this.lessons
      .map((l) => {
        let s = 0;
        const hay = (l.lesson + " " + l.task + " " + l.tags.join(" ")).toLowerCase();
        if (q && hay.includes(q)) s += 10;
        if (l.uses > 0) s += Math.min(l.uses, 5);
        return { ...l, score: s };
      })
      .filter((l) => l.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 5);
  }

  use(id) {
    withFileLock(this.file, () => {
      this.lessons = readJson(this.file, []);
      const l = this.lessons.find((x) => x.id === id);
      if (l) { l.uses += 1; writeJson(this.file, this.lessons); }
    });
  }

  _prune() {
    // 最多保留 200 条
    if (this.lessons.length > 200) {
      this.lessons.sort((a, b) => b.uses - a.uses);
      this.lessons = this.lessons.slice(0, 200);
    }
  }

  context() {
    const recent = [...this.lessons].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 5);
    return recent.map((l) => `- 经验: ${l.lesson}`).join("\n") || "(暂无经验)";
  }
}
