// src/skills/loader.js - Skill Catalog + Loader
// 参考 deepseek-harness 的 skill package(catalog + loader): 可枚举、可发现、可加载的技能注册表
// 扫描 <skillsDir>/*/SKILL.md, 解析 frontmatter(name/description), 提供 list/get/loadAll
import fs from "node:fs";
import path from "node:path";

// 解析 SKILL.md 顶部的 --- frontmatter ---
export function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (mm) meta[mm[1]] = mm[2].trim();
  }
  return meta;
}

export class SkillLoader {
  constructor(skillsDir) {
    this.dir = skillsDir;
  }

  _scan() {
    if (!fs.existsSync(this.dir)) return {};
    const out = {};
    for (const entry of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(this.dir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      const raw = fs.readFileSync(skillMd, "utf8");
      const meta = parseFrontmatter(raw);
      out[entry.name] = {
        id: entry.name,
        name: meta.name || entry.name,
        description: meta.description || "",
        dir: path.join(this.dir, entry.name),
        path: skillMd,
      };
    }
    return out;
  }

  // 可枚举: 全部技能
  list() {
    return Object.values(this._scan());
  }

  // 可发现: 按 id 查
  get(id) {
    return this._scan()[id] || null;
  }

  has(id) {
    return !!this._scan()[id];
  }

  // 读取某个技能的完整 SKILL.md 内容
  read(id) {
    const s = this.get(id);
    if (!s) return null;
    return fs.readFileSync(s.path, "utf8");
  }
}
