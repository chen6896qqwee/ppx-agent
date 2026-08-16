// 插件示例 (一切皆插件, 复制即生效)
// 用法: 复制到项目根 plugins/ 目录, 启动时自动扫描加载
//   cp examples/plugins/extra.cjs plugins/extra.cjs
// 本示例: 注册一个服务 + 消费内置工具注册表加一个工具
module.exports = (ctx) => {
  // 注册一个自定义服务 (其他插件/工具可 consume 到)
  ctx.provide("greeting", "你好");

  // 消费内置 tools 服务, 注册一个额外工具
  ctx.consume("tools").register({
    name: "hello",
    description: "返回问候语。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async () => ctx.consume("greeting"),
  });
};
