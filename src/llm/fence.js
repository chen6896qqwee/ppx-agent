// src/llm/fence.js - 工具围栏协议 (openclaw/dsh 后端的工具代理)
// 背景: openclaw/dsh 是外部完整 agent 进程, 只能通过文本往返。
// PPX 无法把内部 JS 工具注入外部引擎, 故用围栏协议:
//   引擎被要求以纯 LLM 输出工具意图 ⟪tool:name|{"参数":值}⟫
//   PPX 解析围栏 -> 调用自己的工具 -> 把结果拼回消息 -> 引擎继续
// 直到引擎输出无围栏的最终回复。
// 纯函数, 无 I/O, 便于单测。

// 围栏正则: ⟪tool:名字|{json}⟫  (参数用 JSON; 名字限标识符)
const FENCE_RE = /⟪tool:([A-Za-z_][\w]*)│([\s\S]*?)⟫/g;

// 解析引擎文本: 提取 tool_calls, 同时剥离围栏保留纯文本回复
export function parseToolFence(text) {
  const calls = [];
  let clean = String(text);
  let m;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(text)) !== null) {
    const name = m[1];
    const argsRaw = m[2].trim();
    let args = {};
    try { args = JSON.parse(argsRaw || "{}"); } catch { /* 非JSON则空对象 */ }
    calls.push({
      id: "ppx_" + calls.length + "_" + Math.random().toString(36).slice(2, 8),
      type: "function",
      function: { name, arguments: argsRaw || "{}" },
      _args: args,
    });
  }
  if (calls.length) clean = text.replace(FENCE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { calls, clean };
}

// 把工具清单 + 围栏说明拼成注入文本 (传给外部引擎的 system/user)
export function buildFencePrompt(tools) {
  const lines = (tools || []).map((t) => {
    const fn = t.function || t;
    return `- ${fn.name}: ${fn.description || "(无描述)"}`;
  }).join("\n");
  return [
    "[工具协议] 你是纯语言模型, 不执行任何操作。需要工具时, 输出精确围栏(不要假装执行):",
    `调用格式: ⟪tool:工具名│{"参数":值}⟫`,
    `示例: ⟪tool:read_file│{"path":"/tmp/a.txt"}⟫`,
    "规则:",
    "1. 一次只能输出一个围栏, 输出围栏后不要写其他内容。",
    "2. 收到工具结果后根据结果继续推理, 可再输出围栏或输出最终回复。",
    "3. 任务完成时输出最终回复, 不要带围栏。",
    "可用工具清单:",
    lines || "(无)",
  ].join("\n");
}

// 代理循环编排: 往返调用外部引擎直到无围栏或达到轮次上限
// engineReply(combinedText) -> 引擎返回文本   (调用方负责发消息+拿回文本)
// toolRunner(name, args)     -> 工具执行, 返回结果字符串
// options.maxRounds 默认8
export async function proxyToolLoop(engineReply, toolRunner, { maxRounds = 8 } = {}) {
  let context; // 累积上下文文本 (含历史工具结果)
  let finalText = "";
  for (let round = 0; round < maxRounds; round++) {
    const text = await engineReply(context);
    finalText = text;
    const { calls, clean } = parseToolFence(text);
    if (!calls.length) return clean || text; // 无围栏 = 最终回复
    // 有围栏: 执行每个工具, 拼结果回上下文
    let results = [];
    for (const c of calls) {
      let res;
      try { res = await toolRunner(c.function.name, c._args); }
      catch (e) { res = `[皮皮虾] 工具${c.function.name}执行失败: ${e.message}`; }
      results.push(`⟪工具 ${c.function.name} 结果⟫\n` + String(res));
    }
    context = (context ? context + "\n\n" : "") + results.join("\n\n");
    // 提示引擎基于结果继续
    context += "\n\n[请基于上述工具结果继续。若任务完成, 直接输出最终回复, 不要围栏。]";
  }
  return finalText && !parseToolFence(finalText).calls.length ? parseToolFence(finalText).clean : "[皮皮虾] 工具代理轮次过多, 已停止。";
}
