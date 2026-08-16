// 自定义工具示例 (零依赖, 复制即生效)
// 用法: 复制到项目根 custom-tools/ 目录, 启动时自动扫描注册
//   cp examples/custom-tools/hello.cjs custom-tools/hello.cjs
// 注册后与内置工具同权: 可被 LLM 调用、可 enable/disable_capability、计入轨迹统计
module.exports = {
  name: "hello",
  description: "返回问候语。",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "要问候的名字" } },
    required: [],
  },
  execute: async (args) => `你好, ${args.name || "世界"}!`,
};
