// src/memory/memory-ticker.js - 记忆水位移线 (参考 openhanako v4)
// today.md (今日水位线) -> daily/ (每日日记) -> longterm.md (长期记忆)
import fs from "node:fs";
import path from "node:path";
import { ensureDir, readText, writeText, appendLine, logicalDay } from "../utils/store.js";

const TURNS_PER_SUMMARY = 10;

export class MemoryTicker {
  constructor(dataDir, factStore) {
    this.dir = path.join(dataDir, "memory");
    ensureDir(this.dir);
    ensureDir(path.join(this.dir, "daily"));
    this.factStore = factStore;
    this.todayMd = path.join(this.dir, "today.md");
    this.longtermMd = path.join(this.dir, "longterm.md");
    this.stateFile = path.join(this.dir, "daily-state.json");
    this.state = { day: null, turnCount: 0 };
    this._loadState();
    this._rollDay();
  }

  _loadState() {
    try {
      if (fs.existsSync(this.stateFile)) this.state = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
    } catch { this.state = { day: null, turnCount: 0 }; }
  }

  _saveState() {
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), "utf8");
  }

  _rollDay() {
    const today = logicalDay();
    if (this.state.day !== today) {
      if (this.state.day) this._compileDaily();
      this.state.day = today;
      this._saveState();
      writeText(this.todayMd, `# ${today}\n\n`);
    }
  }

  _compileDaily() {
    const today = this.state.day;
    const content = readText(this.todayMd);
    const dailyFile = path.join(this.dir, "daily", `${today}.md`);
    writeText(dailyFile, content || `# ${today}\n`);
    const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- "));
    if (lines.length) {
      let longterm = readText(this.longtermMd);
      longterm += `\n## ${today}\n${lines.join("\n")}\n`;
      writeText(this.longtermMd, longterm);
      writeText(this.todayMd, `# ${logicalDay()}\n\n`);
    }
  }

  recordTurn(user, assistant) {
    this._rollDay();
    this.state.turnCount += 1;
    const line = `- [${new Date().toISOString()}] 用户: ${String(user).slice(0, 200)}`;
    appendLine(this.todayMd, line);
    if (assistant) appendLine(this.todayMd, `  -> ${String(assistant).slice(0, 200)}`);
    this._saveState();
    if (this.state.turnCount % TURNS_PER_SUMMARY === 0) this._compileDaily_Rolling();
    if (user) this.factStore.addMemory(user);
  }

  _compileDaily_Rolling() {
    const content = readText(this.todayMd);
    const lines = content.split("\n").filter((l) => l.trim().startsWith("- "));
    if (lines.length) {
      let longterm = readText(this.longtermMd);
      longterm += `\n## ${logicalDay()} (滚动)\n${lines.slice(-20).join("\n")}\n`;
      writeText(this.longtermMd, longterm);
    }
  }

  context() {
    const today = readText(this.todayMd);
    const longterm = readText(this.longtermMd).slice(-3000);
    const topFacts = this.factsTop();
    return `
# 今日记忆
${today}

# 长期记忆 (最近)
${longterm}

# 关键事实
${topFacts || "(暂无)"}
`;
  }

  factsTop() {
    try {
      return this.factStore.query("", { limit: 8 }).map((f) => `- [${f.score}] ${f.content}`).join("\n");
    } catch { return ""; }
  }
}