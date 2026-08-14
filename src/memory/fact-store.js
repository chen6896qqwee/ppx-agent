// src/memory/fact-store.js - 记忆存储 (高斯衰减遗忘)
// 架构参考 openhanako: 每条记忆有 importance, 高斯衰减, 命中加分
import path from "node:path";
import { ensureDir, readJson, writeJson, nowISO, logicalDay } from "../utils/store.js";

export class FactStore {
  constructor(dataDir, opts = {}) {
    this.dir = path.join(dataDir, "memory");
    ensureDir(this.dir);
    this.file = path.join(this.dir, "facts.json");
    this.opts = {
      decayPerDay: 0.02,   // lambda
      hitBonus: 5,
      baseImportance: 10,
      forgetSpeed: 1.0,
      ...opts,
    };
    this.facts = readJson(this.file, []);
    this.save();
  }

  save() {
    writeJson(this.file, this.facts);
  }

  // 高斯衰减: score = score * exp(-lambda * t^2), t = days since last access
  _decay(score, days) {
    if (days <= 0) return score;
    const lambda = this.opts.decayPerDay * this.opts.forgetSpeed;
    return score * Math.exp(-lambda * days * days);
  }

  _nowDays() {
    return Date.now() / 86400000;
  }

  add(content, { importance = this.opts.baseImportance, type = "general", source = "manual" } = {}) {
    const now = nowISO();
    const fact = {
      id: cryptoRandomId(),
      content,
      type,
      source,
      importance,
      score: importance,
      created: now,
      lastAccess: now,
      hits: 0,
    };
    this.facts.push(fact);
    this.save();
    return fact;
  }

  // ---- 分词(中文按词/英文按token) + 相似度 ----
  _tokenize(s) {
    const cjk = (String(s || "").match(/[\u4e00-\u9fff]+/g) || [])
      .flatMap(w => (w.length >= 2 ? [w] : [])); // 中文: 两字及以上才算词, 避免单字噪声
    const en = (String(s || "").toLowerCase().match(/[a-z0-9]+/g) || []);
    return { cjk, en, all: new Set([...cjk, ...en]) };
  }

  // Jaccard 相似度: |交集|/|并集|
  _jaccard(a, b) {
    const u = new Set([...a, ...b]);
    if (u.size === 0) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter += 1;
    return inter / u.size;
  }

  // 检索: 关键词(子串) + 分词共现 + Jaccard 模糊 + 衰减分排序
  // 相比纯子串匹配, 召回大幅提升: "量化" 能命中 "我搞量化交易"
  // 检索: 简单关键词 + 衰减分排序
  query(q, { limit = 5, minScore = 1 } = {}) {
    const nowD = this._nowDays();
    const ql = (q || "").toLowerCase();
    const qTok = this._tokenize(ql);
    const qAll = qTok.all;
    const scored = [];
    for (const f of this.facts) {
      const days = Math.max(0, nowD - new Date(f.lastAccess).getTime() / 86400000);
      let score = this._decay(f.score, days);
      const fc = f.content.toLowerCase();
      // 1) 子串命中 (强信号)
      if (ql && fc.includes(ql)) score += 10;
      // 2) 分词共现 (每词 +3)
      const fTok = this._tokenize(fc);
      let inter = 0;
      for (const t of qAll) if (fTok.all.has(t)) inter += 1;
      if (inter > 0) score += inter * 3;
      // 3) Jaccard 模糊相似 (语义召回)
      const sim = this._jaccard(qAll, fTok.all);
      if (sim > 0) score += sim * 15;
      if (score >= minScore) scored.push({ ...f, effectiveScore: score });
    }
    scored.sort((a, b) => b.effectiveScore - a.effectiveScore);
    return scored.slice(0, limit);
  }

  hit(id) {
    const f = this.facts.find((x) => x.id === id);
    if (!f) return;
    f.hits += 1;
    f.lastAccess = nowISO();
    f.score += this.opts.hitBonus;
    this.save();
  }

  addMemory(message) {
    // 从对话中提取记忆: 简单启发式, 过滤掉问候/无信息量
    const STOP = ["你好", "在吗", "谢谢", "好的", "嗯", "ok", "哈喽", "hello", "hi", "再见", "拜拜"];
    const clean = (message || "").trim();
    if (!clean || clean.length < 4) return null;
    const lower = clean.toLowerCase();
    if (STOP.some((s) => lower === s.toLowerCase())) return null;
    return this.add(clean, { source: "conversation" });
  }

  list() {
    return [...this.facts].sort((a, b) => b.score - a.score);
  }

  count() {
    return this.facts.length;
  }
}

function cryptoRandomId() {
  return "f_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
