# ppx-agent v1.1.1 — 皮皮虾（PPX Agent）测试版

一个会自我修复、自我学习的超级 Agent。**零运行时依赖**，纯 Node 原生，支持各大模型 API + 本地模型。

> 架构参考 [openhanako/HanaAgent](https://github.com/openhanako/HanaAgent) 与 [TencentDB-Agent-Memory](https://github.com/TencentDB/one-on-mem) 的记忆分层、自愈内核与工具系统精华，用干净自包含实现重搭。感谢这两个开源项目的启发。

本版是 **v1.1.0 发布后的补丁版 (patch)**，修复首次 npm 发布暴露的 bin 入口可执行性问题。

---

## 安装 / 升级

```bash
npm i -g ppx-agent    # 需 Node.js >= 20（package.json engines 声明）
```

| 命令 | 用途 |
|------|------|
| `ppx` | 启动对话 CLI |
| `ppx-serve` | 启动 HTTP 服务（默认 http://127.0.0.1:8899） |
| `ppx-channels` | 通道 CLI（飞书 / 微信） |

验证安装：`ppx --version` 应输出 `1.1.1`。

## 核心特性

- **腾讯式四层记忆**：L0 原始对话 → L1 原子记忆（高斯衰减）→ L2 场景 → L3 核心画像
- **33 个内置工具**：文件 / 命令 / 搜索 / HTTP / 定时 / 记忆检索 / 读图（多模态）/ 文档加载 / 文档入库 / OCR
- **自我修复**：启动体检、损坏 JSON 自动修复、崩溃恢复、残留清理
- **自我学习**：经验库 + 自动提炼用户画像 / refine 失败轨迹闭环 / refineSkill 成功沉淀技能
- **多 Agent 军团**：多进程并行 + DAG 编排 + legion 模式（broadcast / dispatch / runDag）+ spawn_agent 自主协作
- **多渠道接入**：HTTP（可用）+ 飞书（已实现）+ 微信（加解密 + 主动推送）
- **MCP 客户端**：零依赖 MCP（stdio + HTTP Streamable），接入 9600+ MCP 工具服务器
- **命令安全三层防线**：用户 deny 规则 + 硬黑名单 + 高危黑名单 / 前缀白名单 / 反混淆检测
- **SSRF 防护**、**HTTP Bearer 认证**（未配置自动生成 token）
- **流式输出**（SSE）、**上下文滚动摘要**、**ANS 状态化生命周期**
- **多模态读图**（qwen-vl / gpt-4o / glm-4v 路由）+ **RAG 文档加载**

## v1.1.1 变更 — npm bin 入口修复 + bin 包装层

v1.1.0 首次 npm 发布后暴露一个入口缺陷：`ppx-serve` 指向的 `src/server.js` 首行是 **UTF-8 BOM 且无 shebang**。全局安装后 `ppx-serve` 被 symlink 到该文件，shell 无 shebang 会按默认 sh 解析、遇到 JS 语法直接报错；即便补上 shebang，前置 BOM 也会让内核把它当普通文本导致 shebang 仍失效。本版修复根因并重构为更稳的 bin 包装层：

- **去 BOM + 补 shebang**：`src/server.js` 首部删除 UTF-8 BOM（`EF BB BF`），首行加入 `#!/usr/bin/env node`，保存为无 BOM 的 UTF-8 —— `ppx-serve` 现在可被直接执行
- **bin 包装层**：新增 `bin/` 纯 shebang 包装脚本（`bin/ppx.js` / `bin/ppx-serve.js` / `bin/ppx-channels.js`），业务文件不再直接暴露为 CLI 入口，即使源码被误带 BOM 也不影响 CLI 执行
- **`src/server.js` 提取 `runServer()` 公共启动逻辑**，同时保留 `startServer()` 导出（测试/web 引用）与 `node src/server.js` 直接运行两条路径不变
- **`package.json`**：`bin` 三个目标改指 `bin/*.js`；`files` 增加 `"bin/"`（否则 npm publish 不会把 bin 打入包）

### 质量问题排查备注
本评审环境沙箱禁止 `node --test` 子进程 spawn 管道捕获（EPERM），无法在 CI 即沙箱内完整跑测试套件；已用单进程方式覆盖测试所消费的核心 `startServer` 路径（导入→启动→`/health`→退出，exit 0）。本地 `npm test` 应全绿。

## v1.1.0 变更 — 第十轮评价整改（本版不含，属上一版本基线）

- **配置键一致性**（P1）：新增 `config-consistency.test.js`，任何配置键不接消费点/不注册直接 FAIL
- **上下文溢出兜底**（P1）：窗口感知历史预算 + 强制硬裁剪 + 溢出自动降档重试（最多 2 档）
- **脚本数据隔离统一**（P1）：`scripts/lib/tmp-agent.js` 强制数据落在临时根内
- **Web token 持久化**（P2）：HTTP token 落盘复用
- **会话按天分片**（P2）：default 会话按自然日分片
- **死配置清理**（P2）：移除无人读取的 `selfheal.max_restart_attempts`

## 质量信号 (v1.1.0 基线)

- 全量测试 `node --test`：452 项测试，448 过 / 0 失败 / 4 网络跳过
- scripts：acceptance 23/23、bench 0 失败、eval 7/7，均过统一数据隔离 helper

## 许可证

[MIT](https://github.com/chen6896qqwee/ppx-agent/blob/main/LICENSE)