#!/usr/bin/env node
// scripts/gh-release.mjs - 一键建 GitHub Release（原生 UTF-8 body, 根治中文乱码）
// 单一发布通道: node scripts/gh-release.mjs <tag> [body_file]
// 需环境变量 GH_TOKEN（网页 PAT, 需 Contents:write 权限）; 走 api.github.com 直连
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2];
if (!tag) { console.error("用法: node scripts/gh-release.mjs <tag> [body_file]"); process.exit(1); }
const token = process.env.GH_TOKEN || process.env.PPX_GHT || (() => {
  try { const t = fs.readFileSync(path.join(ROOT, '.gh-token'), 'utf8').trim(); return t || null; } catch { return null; }
})();
if (!token) { console.error("缺 token: 设 GH_TOKEN/PPX_GHT 环境变量, 或写 .gh-token 文件"); process.exit(1); }

const bodyFile = process.argv[3] || path.join(ROOT, `release_${tag.replace(/^v/, "")}_body.md`);
const body = fs.existsSync(bodyFile)
  ? fs.readFileSync(bodyFile, "utf8")
  : (await (await fetch(`https://api.github.com/repos/chen6896qqwee/ppx-agent/releases/tags/${tag}`)).ok
      ? await (await fetch(`https://api.github.com/repos/chen6896qqwee/ppx-agent/releases/tags/${tag}`)).json().then(r=>r.body||"")
      : "");

const repo = "chen6896qqwee/ppx-agent";
const url = `https://api.github.com/repos/${repo}/releases`;

// 先查同名 release 是否已存在（避免重复建）
const existing = await fetch(`${url}/tags/${tag}`, { headers: { Authorization: `Bearer ${token}` } });
if (existing.ok) {
  console.log(`⚠️ release ${tag} 已存在, 改为更新 body`);
  const rel = await existing.json();
  await fetch(`${url}/${rel.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body, name: `ppx-agent ${tag} — 皮皮虾测试版`, tag_name: tag }),
  });
} else {
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ tag_name: tag, name: `ppx-agent ${tag} — 皮皮虾测试版`, body }),
  });
  const j = await resp.json();
  if (!resp.ok) { console.error("建 Release 失败:", resp.status, j.message || JSON.stringify(j)); process.exit(1); }
  console.log(`✅ Release 创建成功: ${j.html_url}`);
}
console.log(`body 来源: ${bodyFile} (${Buffer.byteLength(body)} bytes)`);
