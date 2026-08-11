// src/orchestrator/agent-worker.js - 子 agent 进程 (独立 PPXAgent 实例)
// 通过 stdin 收消息, stdout 回结果. 每个 worker 完全隔离.
import { PPXAgent } from "../agent/index.js";

const root = process.cwd();
const dataDir = process.env.PPX_AGENT_DATA_DIR; // 可选: 独立数据目录
const agent = new PPXAgent({ root });

// 从 stdin 读 JSON 行
process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", async (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const req = JSON.parse(line);
      if (req.type === "chat") {
        const reply = await agent.chat(req.message);
        process.stdout.write(JSON.stringify({ id: req.id, type: "reply", reply }) + "\n");
      } else if (req.type === "ping") {
        process.stdout.write(JSON.stringify({ id: req.id, type: "pong", name: agent.config.agent?.name || "ppx" }) + "\n");
      } else if (req.type === "shutdown") {
        agent.shutdown();
        process.stdout.write(JSON.stringify({ id: req.id, type: "bye" }) + "\n");
        process.exit(0);
      }
    } catch (e) {
      process.stdout.write(JSON.stringify({ type: "error", error: e.message }) + "\n");
    }
  }
});