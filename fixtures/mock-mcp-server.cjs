// test/fixtures/mock-mcp-server.cjs - 假 MCP 服务器 (测试 McpClient 用)
// 从 stdin 读 JSON-RPC 行, 回 initialize / tools/list / tools/call
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin });

function respond(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || !msg.method) return;
  if (msg.method === "initialize") {
    respond({
      jsonrpc: "2.0", id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "mock-mcp", version: "1.0.0" },
        capabilities: { tools: {} },
      },
    });
  } else if (msg.method === "tools/list") {
    respond({
      jsonrpc: "2.0", id: msg.id,
      result: {
        tools: [
          { name: "echo", description: "回显输入文本", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
          { name: "add", description: "两数相加", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } },
        ],
      },
    });
  } else if (msg.method === "tools/call") {
    const args = (msg.params && msg.params.arguments) || {};
    const name = msg.params && msg.params.name;
    let text;
    if (name === "add") text = String((Number(args.a) || 0) + (Number(args.b) || 0));
    else text = "echo: " + JSON.stringify(args);
    respond({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text }] } });
  }
});
