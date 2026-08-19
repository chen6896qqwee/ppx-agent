// src/skills/verify.js - 技能入库前确定性验证闸门
// 背景 (DeepSeek-Harness 自进化四拼图之「可靠验证」):
//   refineSkill 由 LLM 提炼技能后直接 create_skill 落盘, 无独立验收环节 —
//   「完成是自报的, 没有独立验收者」。这会让半成品/幻觉技能污染 skills/。
// 本模块提供两重确定性验收 (不依赖 LLM, 静态可测, 缺一即拒):
//   1. 结构验收   — SKILL.md 必须含 ## 流程 + ## 验证 两段 (create_skill 契约)
//   2. 落地接地   — 技能内容必须真实引用提炼它的高频工具, 且该工具确有 ≥minFreq 条近期成功轨迹
// 用法: verifySkill({ name, description, content, hotTools, okTraces, minFreq })
//   -> { ok: boolean, reason?: string }

// 结构验收: 验收必需段落 (create_skill 契约为 流程/反合理化/验证; 至少 流程+验证 缺一不可)
export function requiredSections(content) {
  const c = String(content || "");
  const need = ["## 流程", "## 验证"];
  const missing = need.filter((s) => !c.includes(s));
  return {
    ok: missing.length === 0,
    missing,
    hasFlow: c.includes("## 流程"),
    hasVerify: c.includes("## 验证"),
  };
}

// 落地接地: 技能内容是否真实基于提炼它的高频工具 (反幻觉)
export function groundedInTools(content, hotTools = []) {
  const c = String(content || "");
  const names = (Array.isArray(hotTools) ? hotTools : []).filter(Boolean);
  if (names.length === 0) return { ok: false, reason: "无高频工具可核对" };
  // 内容里出现任一高频工具名 (保持小写忽略原型名大小写)
  const hit = names.find((t) => c.toLowerCase().includes(String(t).toLowerCase()));
  return { ok: !!hit, matchedTool: hit || null, hotTools: names.slice(0, 5) };
}

// 轨迹接地: 该工具确有 ≥minFreq 条近期成功轨迹
export function traceBacked(tool, okTraces = [], minFreq = 2) {
  const arr = Array.isArray(okTraces) ? okTraces : [];
  if (!tool) return { ok: false, reason: "无工具名" };
  const n = arr.filter((t) => t && String(t.tool) === tool).length;
  return { ok: n >= minFreq, count: n, minFreq, tool };
}

// 总闸门
export function verifySkill({ name, content, hotTools, okTraces, minFreq = 2 } = {}) {
  // 1. 结构验收
  const s = requiredSections(content);
  if (!s.ok) {
    return { ok: false, reason: `技能缺必需段落: ${s.missing.join(", ")} (SKILL.md 契约要求 ## 流程 + ## 验证)` };
  }
  // 内容太短 (只够段落标题没实质步骤) 也拒
  const body = String(content || "").replace(/##\s*\S+/g, "").trim();
  if (body.length < 20) {
    return { ok: false, reason: "技能内容太短, 缺实质步骤/检查点" };
  }
  // 2. 落地接地: 内容引用高频工具
  const g = groundedInTools(content, hotTools);
  if (!g.ok) {
    return { ok: false, reason: `技能内容未引用提炼它的高频工具 (${g.hotTools.join(", ")})` };
  }
  // 3. 轨迹接地: 该工具有足够近期成功轨迹背书
  const tb = traceBacked(g.matchedTool, okTraces, minFreq);
  if (!tb.ok) {
    return { ok: false, reason: `工具 ${g.matchedTool} 成功轨迹不足 (${tb.count}/${tb.minFreq})` };
  }
  return { ok: true, matchedTool: g.matchedTool, traceCount: tb.count };
}