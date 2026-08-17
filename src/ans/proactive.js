// src/ans/proactive.js - 自主任务生成 (ANS)
// 扫描 L1 事实(FactStore.list())里的待办/偏好信号 → 结构化提醒 payload
//
// 输出契约 (ticker 回调 / 通道消费方):
//   payload = { ts: number, items: Array<{content, importance, source, id}>, text: string }
//   - text: 可直接投递的一句话文本 (LLM 语义提炼或启发式拼接)
//   - items: 结构化条目, 供通道方自行排版/去重/分级
//   - 无待办信号或生成失败 → null (不打扰)
// 投递保证: 非 null 才回调; 回调异常被捕获, 不影响定时器
import { info } from "../utils/logger.js";

// 待办/偏好信号词 (启发式)
const PENDING_RE = /待办|需要|记得|计划|还没|未完成|想|要|必须/;

// 结构化扫描: 从 L1 事实里筛出待办信号 (契约的数据源)
export function pendingTasks(agent, { limit = 5 } = {}) {
  if (!agent || !agent.facts) return [];
  return agent.facts.list()
    .filter((f) => f && PENDING_RE.test(String(f.content || "")))
    .slice(0, limit)
    .map((f) => ({
      content: String(f.content || "").slice(0, 100),
      importance: f.importance ?? 0,
      source: f.source || "manual",
      id: f.id || null,
    }));
}

// 生成主动提醒: 有 LLM 走语义提炼 (1-3 条简短提醒), 无 LLM 走启发式拼接
export async function suggestProactive(agent) {
  try {
    const items = pendingTasks(agent);
    if (!items.length) return null;
    const lines = items.map((t) => "- " + t.content);
    if (!agent.llm) {
      return { ts: Date.now(), items, text: "【主动提醒】你之前提到过:\n" + lines.join("\n") };
    }
    const r = await agent.llm.chat([
      { role: "system", content: "你是主动助手。基于用户历史提到的待办/偏好, 生成 1-3 条简短主动提醒 (每条 ≤30 字, 直接输出, 不要客套)。" },
      { role: "user", content: lines.join("\n") },
    ]);
    const text = String(r?.content || "").trim();
    return text ? { ts: Date.now(), items, text } : null;
  } catch (e) {
    info(`[proactive] 生成失败: ${e.message}`);
    return null;
  }
}
