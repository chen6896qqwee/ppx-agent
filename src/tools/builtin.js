// src/tools/builtin.js - 内置工具集 (皮皮虾的手脚)
// 文件/命令/时间/记忆查询 — 全部零依赖, 用 Node 原生
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scrubPII } from "../utils/pii.js";

const execFileP = promisify(execFile);

// 图片 MIME 表 (read_image + 多模态注入共用)
const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp" };

// 读图片文件转 base64 data URL (供 read_image 工具与多模态 user 消息注入复用)
export function imageFileToDataUrl(rootDir, p, { maxBytes = 8 * 1024 * 1024 } = {}) {
  const fp = safePath(rootDir, p);
  const mime = IMAGE_MIME[path.extname(fp).toLowerCase()];
  if (!mime) throw new Error("不支持的文件类型: " + path.extname(fp));
  if (!fs.existsSync(fp)) throw new Error("文件不存在: " + p);
  const buf = fs.readFileSync(fp);
  if (buf.length > maxBytes) throw new Error(`图片过大 (>${Math.round(maxBytes / 1024 / 1024)}MB)`);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

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

// ---- code_act (CodeAct 出口): 一次提交脚本批量操作, 压 N 轮工具往返 → 1 轮 ----
// 安全: 默认关闭 (security.code_act), 开启后限 python/node 解释器 + 工作目录 + 超时 + PII + 黑名单扫描
// 相比 run_command 的增量风险: 脚本体绕过命令串黑名单, 故独立开关 + 默认关闭
// 沙箱加固 (进程级): 干净环境变量(剥离密钥/令牌) + node 内存上限 + 超时强杀进程树 + 输出上限
//   真正隔离需外部 Docker/MicroVM (见 docs/CONFIG.md), 此处为无依赖下的最大进程级约束

// 干净沙箱环境: 只保留运行必需变量, 剥离一切敏感密钥/令牌/凭证, 防脚本窃取宿主凭据
const SANDBOX_ENV_KEEP = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|HOMEDRIVE|HOMEPATH|COMSPEC|OS|PROCESSOR_ARCHITECTURE|PROCESSOR_IDENTIFIER|NUMBER_OF_PROCESSORS|LANG|LC_|PYTHONIOENCODING|PYTHONPATH)$/i;
function sandboxEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v && SANDBOX_ENV_KEEP.test(k)) env[k] = v;
  }
  return env;
}

const CODE_ACT_MEMORY_MB = 256;      // node 解释器内存上限
const CODE_ACT_OUTPUT_MAX = 512 * 1024; // 输出上限 512KB

export async function runCodeAct(rootDir, lang, code, timeoutMs) {
  const isWin = process.platform === "win32";
  const ext = lang === "node" ? "js" : "py";
  const tmp = path.join(os.tmpdir(), `ppx_codeact_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`);
  fs.writeFileSync(tmp, code, "utf8");
  const interpreter = lang === "node" ? process.execPath : (isWin ? "python" : "python3");
  // node 加内存上限; python 无等价零依赖参数 (可外接 Docker 时再限制)
  const args = lang === "node" ? [`--max-old-space-size=${CODE_ACT_MEMORY_MB}`, tmp] : [tmp];
  try {
    const { stdout, stderr } = await execFileP(interpreter, args, {
      cwd: rootDir,
      timeout: timeoutMs || 30000,
      maxBuffer: CODE_ACT_OUTPUT_MAX,
      env: sandboxEnv(),
      windowsHide: true,
    });
    const out = (stdout || "") + (stderr ? "\n[stderr] " + stderr : "");
    return scrubPII(out).cleaned.slice(0, 20000) || "(无输出)";
  } catch (e) {
    // 超时/输出超限/内存超限的友好提示
    if (e.killed || /timed out|ETIMEDOUT/i.test(e.message)) {
      return JSON.stringify({ error: `code_act 执行超时 (${timeoutMs || 30000}ms), 已强制终止` });
    }
    return JSON.stringify({ error: e.message, code: e.code });
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
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

  // 4.5 code_act (CodeAct 出口): 脚本批量操作, 压 N 轮工具往返 → 1 轮
  catalog.register({
    name: "code_act",
    description: "用 Python/Node 脚本一次性完成多个操作(读文件/处理数据/写结果), 用 print/console.log 输出结果。默认关闭, 需 security.code_act=true。",
    parameters: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["python", "node"], description: "脚本语言" },
        code: { type: "string", description: "脚本内容" },
      },
      required: ["language", "code"],
    },
    execute: async (args, ctx) => {
      const sec = (ctx && ctx.agent && ctx.agent.config && ctx.agent.config.security) || {};
      if (!sec.allow_all && !sec.code_act) {
        return JSON.stringify({ error: "code_act 未开启: 在 security 设置 code_act=true (或 allow_all=true)" });
      }
      const lang = String(args.language || "").toLowerCase();
      if (!["python", "node"].includes(lang)) return JSON.stringify({ error: "language 仅支持 python/node" });
      const code = String(args.code || "");
      if (!code) return JSON.stringify({ error: "空代码" });
      if (isDeniedCommand(code, sec)) return JSON.stringify({ error: "代码命中高危黑名单 (delete/format/shutdown等)" });
      return runCodeAct(rootDir, lang, code, sec.command_timeout_ms);
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

  // 8. 读图片 (多模态): 返回 base64 data URL, 供多模态模型视觉理解
  catalog.register({
    name: "read_image",
    description: "读取图片文件, 返回 base64 data URL 供多模态模型理解图片内容 (需配置支持视觉的模型, 如 gpt-4o/qwen-vl/glm-4v)。",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "图片文件路径 (相对工作目录)" } },
      required: ["path"],
    },
    execute: async (args) => {
      try {
        return imageFileToDataUrl(rootDir, args.path);
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    },
  });

  return catalog;
}