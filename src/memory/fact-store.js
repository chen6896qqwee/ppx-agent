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
    // 倒排索引: token -> Set<factId>, 检索 O(n) -> O(候选)
    this._index = new Map();
    // BM25 作用域统计缓存 (facts 内容不可变, add 时失效即可), 避免每查询 O(N) 重算
    this._statsCache = new Map();
    for (const fact of this.facts) this._indexFact(fact);
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

  // 内容归一化: 去首尾空白 + 折叠连续空白, 用于去重比对
  _norm(s) {
    return String(s || "").trim().replace(/\s+/g, " ");
  }

  add(content, { importance = this.opts.baseImportance, type = "general", source = "manual", dedupe = true, scope = null, meta = null } = {}) {
    const norm = this._norm(content);
    if (!norm) return null;
    const now = nowISO();
    if (dedupe) {
      // 内容去重: 相同内容已存在则命中加分, 不新增
      const existing = this.facts.find((f) => this._norm(f.content) === norm);
      if (existing) {
        existing.hits += 1;
        existing.lastAccess = now;
        existing.score += this.opts.hitBonus;
        this.save();
        return existing;
      }
    }
    const fact = {
      id: cryptoRandomId(),
      content: norm,
      type,
      source,
      importance,
      score: importance,
      created: now,
      lastAccess: now,
      hits: 0,
      scope,
      ...(meta ? { meta } : {}),
    };
    this.facts.push(fact);
    this._indexFact(fact);
    this._statsCache.clear(); // 新增事实 -> 作用域统计失效
    this.save();
    return fact;
  }

  // 字符级索引 key: 中文拆单字 + 英文按 token (对中文检索才有效)
  // 索引层用单字(宽召回), 精排用 bigram(准匹配)
  _charKeys(s) {
    const chars = (String(s).match(/[\u4e00-\u9fff]/g) || []); // 中文单字
    const en = (String(s).toLowerCase().match(/[a-z0-9]+/g) || []); // 英文/数字 token
    return new Set([...chars, ...en]);
  }

  // 倒排索引: 把一条事实的字符 key 挂到索引 (key -> factId)
  _indexFact(fact) {
    for (const k of this._charKeys(fact.content)) {
      if (!this._index.has(k)) this._index.set(k, new Set());
      this._index.get(k).add(fact.id);
    }
  }

  // 重建索引 (facts 外部变更后调用)
  rebuildIndex() {
    this._index = new Map();
    this._statsCache.clear();
    for (const fact of this.facts) this._indexFact(fact);
    return this._index.size;
  }

  // ==== BM25 检索 (升级版) ====

  // 精排分词: 中文 bigram + 英文 token (解决"止损"匹配"止损规则"的长段问题)
  _bigramSet(s) {
    const out = new Set();
    const low = String(s || "").toLowerCase();
    const cjk = low.match(/[\u4e00-\u9fff]+/g) || [];
    for (const seg of cjk) {
      if (seg.length === 1) { out.add(seg); continue; }
      for (let i = 0; i < seg.length - 1; i++) out.add(seg.slice(i, i + 2));
    }
    const en = low.match(/[a-z0-9]+/g) || [];
    for (const tk of en) out.add("en:" + tk);
    return out;
  }

  // 在作用域内统计 bigram 文档频率 / 平均长度 (BM25 参数)
  // 关键: df 用 bigram token 统计 (而非单字索引), 否则 IDF 恒为常数, 失去"罕见词权重高"的灵魂
  // 同时在 scoped 内计算, 保证 scope (AML 多租户) 统计隔离
  _queryStats(scoped) {
    const N = scoped.length;
    const df = new Map();
    let totalLen = 0;
    for (const f of scoped) {
      const bg = this._bigramSet(f.content);
      totalLen += bg.size;
      for (const t of bg) df.set(t, (df.get(t) || 0) + 1);
    }
    return { N, avgdl: N ? totalLen / N : 1, df };
  }

  // 单查询词 IDF: ln(1 + (N - df + 0.5)/(df + 0.5))
  // df 来自作用域内 bigram 文档频率 (见 _queryStats), 罕见词高分、常见词低分
  _idf(tok, stats) {
    const df = stats.df.get(tok) || 0;
    return Math.log(1 + (stats.N - df + 0.5) / (df + 0.5));
  }

  // BM25 打分 (简化 tf=1, 因 tokenize 去重为 set)
  _bm25Score(fact, qAll, stats) {
    const fAll = this._bigramSet(fact.content);
    if (!fAll.size) return 0;
    const docLen = fAll.size;
    const k1 = 1.5;
    const b = 0.75;
    let s = 0;
    for (const t of qAll) {
      if (!fAll.has(t)) continue;
      const idf = this._idf(t, stats);
      const tf = 1;
      s += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / stats.avgdl))));
    }
    return s;
  }

  // 检索: BM25 主导 (IDF 区分常见/罕见词 + 长度归一) + 子串强信号 + 高斯衰减(乘性时效) + 命中权重
  query(q, { limit = 5, minScore = 1, scope = null } = {}) {
    const nowD = this._nowDays();
    const ql = (q || "").toLowerCase();
    const qAll = this._bigramSet(ql);
    // scope 过滤基底 (检索隔离: 只查指定 scope 的事实)
    const scoped = scope == null ? this.facts : this.facts.filter((f) => f.scope === scope);
    // 空查询: 按衰减分返回全部 (保持旧行为, 供 memory-ticker 取 top facts)
    if (qAll.size === 0) {
      return scoped
        .map((f) => ({ ...f, effectiveScore: this._decay(f.score, Math.max(0, nowD - new Date(f.lastAccess).getTime() / 86400000)) }))
        .sort((a, b) => b.effectiveScore - a.effectiveScore)
        .slice(0, limit);
    }
    // 倒排候选集 (至少命中一个查询字符 key; 阈值保护防常见字退化)
    let candidates = scoped;
    const qKeys = this._charKeys(q);
    if (qKeys.size > 0 && this._index && this._index.size) {
      const candIds = new Set();
      for (const k of qKeys) {
        const ids = this._index.get(k);
        if (ids) for (const id of ids) candIds.add(id);
      }
      if (candIds.size > 0 && candIds.size <= scoped.length * 0.9) {
        candidates = scoped.filter((f) => candIds.has(f.id));
      }
    }
    // BM25 参数在作用域内计算, 按 scope 缓存 (facts 不可变, add 时失效)
    const scopeKey = scope == null ? "__all__" : "s:" + scope;
    let stats = this._statsCache.get(scopeKey);
    if (!stats) { stats = this._queryStats(scoped); this._statsCache.set(scopeKey, stats); }
    const scored = [];
    for (const f of candidates) {
      const days = Math.max(0, nowD - new Date(f.lastAccess).getTime() / 86400000);
      const fc = f.content.toLowerCase();
      // BM25 主导
      const bm = this._bm25Score(f, qAll, stats);
      // 无交集(词未命中且无整句子串)则跳过, 避免返回无关噪声
      if (bm === 0 && !(ql && fc.includes(ql))) continue;
      // 时效+命中权重做成"乘性因子": 越新越接近 1, 越旧最多折到 0.4 倍
      // 避免旧记忆(短)靠微弱加法反超新记忆(长), 保证新旧事实冲突时返回新事实
      const recency = Math.exp(-this.opts.decayPerDay * days * days); // 0~1, 越新越大
      let s = bm * 10 * (0.4 + 0.6 * recency);
      // 子串强信号 (整句命中)
      if (ql && fc.includes(ql)) s += 5;
      // 命中权重 (辅助)
      s += (f.hits > 0 ? Math.min(f.hits, 5) : 0);
      if (s >= minScore) scored.push({ ...f, effectiveScore: s, bm25: bm });
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