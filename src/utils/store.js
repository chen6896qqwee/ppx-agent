// src/utils/store.js - 零依赖文件存储 (JSON + 原子写)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function atomicWrite(file, data) {
  ensureDir(path.dirname(file));
  const tmp = file + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmp, data, "utf8");
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    // 并发写同一文件时 rename 可能 EPERM (Windows): 降级为直接写, 保数据不丢
    try { fs.unlinkSync(tmp); } catch {}
    fs.writeFileSync(file, data, "utf8");
  }
}

export function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    let raw = fs.readFileSync(file, "utf8");
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // 去 BOM
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(file, obj) {
  atomicWrite(file, JSON.stringify(obj, null, 2));
}

export function readText(file, fallback = "") {
  try {
    if (!fs.existsSync(file)) return fallback;
    return fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
}

export function writeText(file, text) {
  atomicWrite(file, text);
}

export function appendLine(file, line) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, line + "\n", "utf8");
}

export function nowISO() {
  return new Date().toISOString();
}

export function logicalDay(d = new Date()) {
  // 逻辑日 (本地时区): 今日/归档/按天检索统一用本地年月日
  // 与 eventsByDay() 的本地解析保持一致, 避免 8 小时时区偏移导致按天检索错位
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
