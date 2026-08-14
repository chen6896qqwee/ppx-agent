// src/tools/builtin.js - 内置工具集 (皮皮虾的手脚)
// 文件/命令/时间/记忆查询 — 全部零依赖, 用 Node 原生
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scrubPII } from "../utils/pii.js";

const execFileP = promisify(execFile);

// ---- run_command 安全策略 (P0) ----
const DEFAULT_DENY = [
  /delete|erase|rmdir|rd \/s|deltree/i,
  /format\s/i, /mkfs/i, /fdisk/i, /diskpart/i, /shutdown/i,
  /restart/i, /reboot/i, /halt/i, /poweroff/i,
  /reg\s+delete/i, /taskkill/i, /pkill/i, /kill\s+-9/i,
  /rm\s+-rf/i, /rm\s+-fr/i,
  /curl|wget|Invoke-WebRequest|iwr/i,
  /git\s+push.*--force/i, /git\s+reset.*--hard/i,
];
const DEFAULT_ALLOW_PREFIX = [
  "git", "npm", "npx", "yarn", "pnpm", "node", "python", "python3",
  "ls", "dir", "pwd", "cat", "type", "echo", "head", "tail", "grep",
  "find", "wc", "cp", "copy", "mv", "move", "mkdir", "touch", "tree",
  "cd", "help", "ipconfig", "netstat", "tasklist", "whoami", "date", "time", "tsc",
];

function isDeniedCommand(cmd, options) {
  const deny = (options && options.denyList) || DEFAULT_DENY;
  for (const re of deny) if (re.test(cmd)) return true;
  return false;
}

function isAllowedCommand(cmd, options) {
  if (options && options.allowAll) return true;
  const allowPrefix = (options && options.allowPrefix) || DEFAULT_ALLOW_PREFIX;
  const first = cmd.trim().split(/[\s|&;>]+/)[0];
  return allowPrefix.some((a) => (first.toLowerCase().replace(/\.exe$/i, "") === a.toLowerCase()));
}

// 安全路径: 阻止逃出工作目录 (防路径穿越)
function safePath(root, p) {
  const resolved = path.resolve(root, p);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`路径越界拒绝: ${p}`);
  }
  return resolved;
}

// 注册全部内置工具
export function registerBuiltinTools(catalog, { rootDir, facts, memory }) {
  // 1. 读文件
  catalog.register({
    name: "read_file",
    description: "读取文件内容。返回文件文本。",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "文件路径 (相对工作目录)" } },
      required: ["path"],
    },
    execute: async (args) => {
      const p = safePath(rootDir, args.path);
      if (!fs.existsSync(p)) return JSON.stringify({ error: `文件不存在: ${args.path}` });
      const content = fs.readFileSync(p, "utf8");
      return content.slice(0, 20000);
    },
  });

  // 2. 写文件
  catalog.register({
    name: "write_file",
    description: "写入文件 (覆盖)。可用于创建/修改文件。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        content: { type: "string", description: "要写入的内容" },
      },
      required: ["path", "content"],
    },
    execute: async (args) => {
      const p = safePath(rootDir, args.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, args.content, "utf8");
      return JSON.stringify({ ok: true, bytes: Buffer.byteLength(args.content) });
    },
  });

  // 3. 列目录
  catalog.register({
    name: "list_dir",
    description: "列出目录内容 (文件名列表)。",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "目录路径, 默认工作目录" } },
    },
    execute: async (args) => {
      const p = safePath(rootDir, args.path || ".");
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
        return JSON.stringify({ error: `目录不存在: ${args.path || "."}` });
      }
      const items = fs.readdirSync(p).map((f) => {
        const fp = path.join(p, f);
        const st = fs.statSync(fp);
        return `${st.isDirectory() ? "[D]" : "[F]"} ${f}`;
      });
      return items.join("\n");
    },
  });

  // 4. 执行命令 (安全: 限制在允许目录, 超时)
  catalog.register({
    name: "run_command",
    description: "执行 shell 命令并返回输出。只能在工作目录内执行, 有超时。",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "要执行的命令" } },
      required: ["command"],
    },
    execute: async (args, ctx) => {
      const cmd = String(args.command || "").trim();
      if (!cmd) return JSON.stringify({ error: "空命令" });
      const opts = (ctx && ctx.agent && ctx.agent.config && ctx.agent.config.security) || {};
      if (isDeniedCommand(cmd, opts)) {
        return JSON.stringify({ error: "命令被拒绝: 命中高危黑名单 (delete/format/shutdown/curl等). 如需放行配置 security 白名单." });
      }
      if (!isAllowedCommand(cmd, opts)) {
        return JSON.stringify({ error: "命令不在白名单: " + cmd.split(/[\s|&;>]+/)[0] + ". 允许: git/npm/node/python/cat/cp/mkdir 等, 或设置 security.allow_all." });
      }
      try {
        const isWin = process.platform === "win32";
        const { stdout, stderr } = await execFileP(isWin ? "cmd.exe" : "/bin/sh", [
          isWin ? "/c" : "-c",
          cmd,
        ], { cwd: rootDir, timeout: 30000, maxBuffer: 1024 * 1024 });
        const out = (stdout || "") + (stderr ? "\n[stderr] " + stderr : "");
        return scrubPII(out).cleaned.slice(0, 20000) || "(无输出)";
      } catch (e) {
        return JSON.stringify({ error: e.message, code: e.code });
      }
    },
  });

  // 5. 当前时间
  catalog.register({
    name: "get_time",
    description: "获取当前日期和时间。",
    parameters: { type: "object", properties: {} },
    execute: async () => new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
  });

  // 6. 记忆查询 (皮皮虾自己查记忆)
  catalog.register({
    name: "memory_search",
    description: "搜索皮皮虾的记忆库, 返回相关事实。",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "要搜的内容" }, limit: { type: "number" } },
      required: ["query"],
    },
    execute: async (args) => {
      if (!facts) return JSON.stringify({ error: "记忆未初始化" });
      const results = facts.query(args.query, { limit: args.limit || 5 });
      return results.length
        ? results.map((r) => `- [${r.score}] ${r.content}`).join("\n")
        : "(无匹配记忆)";
    },
  });

  // 7. 记住新事实
  catalog.register({
    name: "memory_add",
    description: "把一条重要信息写进皮皮虾的长期记忆。",
    parameters: {
      type: "object",
      properties: { content: { type: "string", description: "要记住的内容" } },
      required: ["content"],
    },
    execute: async (args) => {
      if (!facts) return JSON.stringify({ error: "记忆未初始化" });
      const f = facts.add(args.content, { source: "agent-self" });
      return JSON.stringify({ ok: true, id: f.id });
    },
  });

  return catalog;
}