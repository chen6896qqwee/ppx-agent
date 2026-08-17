// src/config/settings.js - 通用设置读写 (HTTP API 后端)
// 覆盖 config/ppx.json 顶层字段: user / channels.http / security / agent 预设 (values/system_extra/citation_rule/mode)
// 设计 (与 providers.js 对齐):
//   - 唯一事实源 = config/ppx.json
//   - 写盘: 备份原文件 → 原子写 (.tmp + rename) → 防配置丢失
//   - 读取: 深度合并默认值 (loadConfig), 保证前端总能拿到完整结构
//   - 热重载: 写盘后由调用方调 agent.reload() 重建内存
import fs from "node:fs";
import path from "node:path";
import { loadConfig, DEFAULT_CONFIG } from "./index.js";
import { warn } from "../utils/logger.js";

function getConfigPath(root) {
  return path.join(root, "config", "ppx.json");
}

// 读取当前 config (磁盘原文), 缺文件返回空
export function readConfigRaw(root) {
  const p = getConfigPath(root);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { warn("config/ppx.json 读取失败:", e.message); return {}; }
}

// 写盘: 先备份 (保留最近 3 个), 再原子写 (tmp + rename)
function writeConfigAtomic(root, cfg) {
  const p = getConfigPath(root);
  if (fs.existsSync(p)) {
    const bak = p + ".bak-" + new Date().toISOString().replace(/[:.]/g, "-");
    try { fs.copyFileSync(p, bak); } catch (e) { warn("备份失败:", e.message); }
    try {
      const dir = path.dirname(p);
      const base = path.basename(p);
      const baks = fs.readdirSync(dir)
        .filter((f) => f.startsWith(base + ".bak-"))
        .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }));
      baks.sort((a, b) => b.t - a.t);
      for (const old of baks.slice(3)) {
        try { fs.unlinkSync(path.join(dir, old.f)); } catch {}
      }
    } catch {}
  }
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

// 通用设置字段白名单 (GET 返回 + PUT 可改的顶层键)
// 每个键对应 config 里的一个可编辑分区, 值里的字段再细分
export const SETTINGS_FIELDS = {
  user: ["name"],
  http: ["port", "auth_token"],
  security: ["allow_all", "command_timeout_ms", "code_act"],
  agent: ["name", "mode", "citation_rule", "system_extra", "values"],
};

// 安全视图: 抹掉敏感明文 (auth_token / api_key), 只暴露 set 标志
function sanitizeSettings(cfg) {
  const out = {
    user: { name: cfg.user?.name || "兄弟" },
    http: {
      port: cfg.channels?.http?.port ?? 8899,
      auth_token_set: !!(cfg.channels?.http?.auth_token),
    },
    security: {
      allow_all: !!cfg.security?.allow_all,
      command_timeout_ms: cfg.security?.command_timeout_ms ?? 30000,
      code_act: !!cfg.security?.code_act,
    },
    agent: {
      name: cfg.agent?.name || "皮皮虾",
      mode: cfg.agent?.mode || "react",
      citation_rule: cfg.agent?.citation_rule ?? "",
      system_extra: cfg.agent?.system_extra ?? "",
      values: Array.isArray(cfg.agent?.values) ? cfg.agent.values : (DEFAULT_CONFIG.agent?.values || []),
    },
  };
  return out;
}

// GET /api/settings: 返回可编辑设置的安全视图
export function getSettings(root) {
  // 用 loadConfig 深合并默认值, 保证缺字段也有结构; 但 write 需基于磁盘原文避免覆盖默认
  const merged = loadConfig(root);
  return sanitizeSettings(merged);
}

// PUT /api/settings: 只更新白名单字段, 返回更新后的安全视图
// patch = { user?: {name}, http?: {port, auth_token}, security?: {...}, agent?: {...} }
// 校验: 端口范围 / 超时范围 / values 必须是字符串数组
export function updateSettings(root, patch) {
  if (!patch || typeof patch !== "object") throw new Error("patch 必须是对象");
  const cfg = readConfigRaw(root);
  cfg.user = { ...(cfg.user || {}), ...(patch.user || {}) };
  cfg.channels = cfg.channels || {};
  cfg.channels.http = { ...(cfg.channels.http || {}), ...(patch.http || {}) };
  cfg.security = { ...(cfg.security || {}), ...(patch.security || {}) };
  cfg.agent = { ...(cfg.agent || {}), ...(patch.agent || {}) };

  // 校验
  const port = cfg.channels.http.port;
  if (port != null && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error("HTTP 端口必须是 1-65535 的整数");
  const timeout = cfg.security.command_timeout_ms;
  if (timeout != null && (!Number.isFinite(timeout) || timeout < 1000)) throw new Error("命令超时至少 1000ms");
  if (cfg.agent.values != null && !Array.isArray(cfg.agent.values)) throw new Error("核心价值必须是字符串数组");
  if (cfg.agent.values && cfg.agent.values.some((v) => typeof v !== "string")) throw new Error("核心价值必须是字符串数组");
  if (cfg.agent.mode != null && !/^[a-z-]{2,30}$/.test(String(cfg.agent.mode))) throw new Error("编排模式只含小写字母/横线");

  writeConfigAtomic(root, cfg);
  return sanitizeSettings(cfg);
}

// 可编辑字段元数据 (供前端渲染表单, 免前端硬编码结构)
export function settingsSchema() {
  return SETTINGS_FIELDS;
}
