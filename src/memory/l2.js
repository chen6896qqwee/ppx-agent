// src/memory/l2.js - L2 场景记忆 (腾讯风格 scene extraction)
// 把相关记忆归档成场景: { name, keywords, facts[], lastUpdated }
// 零依赖: 用关键词聚类 + 时间窗聚合
import path from "node:path";
import { ensureDir, readJson, writeJson, logicalDay } from "../utils/store.js";

// 中文简单分词: 提取有意义的词 (2字以上连续片段 + 已知高频概念)
const STOP = new Set(["这个","那个","我们","你们","他们","什么","怎么","可以","一个","就是","知道","没有","如果","因为","所以","但是","然后","现在","今天","昨天","明天","已经","还有","所有","这样","那样","自己","的时候","一下","一点","一些","这些","那些","东西","事情","问题","觉得","应该","需要","开始","继续","大家","真的","只是","可能","不是","都是","一直","非常","其实","最后","最后","主要","联系","关系"]);

function tokenize(text) {
  const clean = String(text || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, " ");
  const words = clean.split(/\s+/).filter(Boolean);
  const cjk = clean.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  return [...new Set([...words, ...cjk.map((w) => w.toLowerCase())].filter((w) => !STOP.has(w) && w.length >= 2))];
}

export class SceneStore {
  constructor(dataDir) {
    this.dir = path.join(dataDir, "memory", "l2");
    ensureDir(this.dir);
    this.file = path.join(this.dir, "scenes.json");
    this.scenes = readJson(this.file, []);
  }

  // 把一条事实归入最匹配的场景 (或新建)
  assign(fact) {
    const tokens = tokenize(fact.content);
    if (!tokens.length) return null;

    // 找最匹配的场景
    let best = null, bestScore = 0;
    for (const s of this.scenes) {
      let score = 0;
      for (const t of tokens) if ((s.keywords || []).includes(t)) score++;
      if (score > bestScore) { bestScore = score; best = s; }
    }

    if (best && bestScore >= 1) {
      best.facts.push({ id: fact.id, content: fact.content, ts: fact.created });
      if (best.facts.length > 50) best.facts = best.facts.slice(-50);
      best.lastUpdated = logicalDay();
      // 合并新关键词
      for (const t of tokens) if (!best.keywords.includes(t)) best.keywords.push(t);
      if (best.keywords.length > 30) best.keywords = best.keywords.slice(-30);
    } else {
      best = {
        id: "s_" + Math.random().toString(36).slice(2, 8),
        name: tokens.slice(0, 3).join("·"),
        keywords: tokens.slice(0, 10),
        facts: [{ id: fact.id, content: fact.content, ts: fact.created }],
        created: logicalDay(),
        lastUpdated: logicalDay(),
      };
      this.scenes.push(best);
    }
    writeJson(this.file, this.scenes);
    return best;
  }

  // 按记忆 id 找回场景
  findByFactId(id) {
    return this.scenes.find((s) => s.facts.some((f) => f.id === id));
  }

  context(limit = 5) {
    return this.scenes.slice(-limit).map((s) =>
      `【场景:${s.name}】\n${s.facts.slice(-5).map((f) => `  - ${f.content}`).join("\n")}`
    ).join("\n");
  }

  count() { return this.scenes.length; }

  _save() { writeJson(this.file, this.scenes); }
}