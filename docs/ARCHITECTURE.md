# 架构说明

皮皮虾是一个**独立自包含的纯 Node agent**（零运行时依赖）。默认用 http 后端直连 OpenAI 兼容 API，同时吸收 OpenClaw 与 DeepSeek Harness 的架构精华。

## 整体架构

```
┌─────────────── 通道层 ───────────────┐
│  CLI    HTTP API   飞书    微信       │
│ (cli.js) (server.js) (feishu) (wechat)│
└──────────────────┬───────────────────┘
                   │
┌──────────────────▼───────────────────┐
│           PPXAgent (内核)             │
│  src/agent/index.js — 编排核心        │
│  · chat / chatStream 主入口           │
│  · _llmWithFallback 多provider回退    │
│  · _llmWithTools 工具调用循环          │
└──────┬────────────┬────────────┬──────┘
       │            │            │
┌──────▼─────┐ ┌────▼─────┐ ┌───▼────────┐
│ 一切皆插件   │ │ 模式注册表 │ │ 军团编排    │
│ Context +   │ │ ModeReg-  │ │ Legion +   │
│ builtinPlu- │ │ istry (7) │ │ DAG (多进程)│
│ gins (11个) │ │           │ │            │
└─────────────┘ └───────────┘ └────────────┘
```

## 核心设计

### 1. 一切皆插件（吸收 dsh Cordis 理念）

`src/plugin/context.js` 提供轻量容器：`provide(key, value)` 注册、`consume(key)` 消费（父子查找）、`onDispose` 可逆效果。`src/plugin/builtin.js` 的 11 个内置插件按「依赖在前」的顺序装配，任何模块都可被用户插件替换。

### 2. 会话即唯一事实源（吸收 dsh「Model-visible ⟺ logged」）

`src/memory/session.js` 是 **append-only 事件日志**（不可变），每条 `{seq, ts, type, data}`：
- `deriveMessages()` 投影 user/assistant（模型可见历史）
- `deriveCompacted()` 投影压缩后的历史（compaction 事件替换被压缩区间）
- `fork()` 从边界派生新会话，`replay()` 回放完整事件流

### 3. 四层记忆（L0 → L3）

```
对话 → L0 原始对话(事件日志) → L1 原子记忆(fact-store, 高斯衰减) → L2 场景(聚类) → L3 画像(persona)
```
- L1 检索用**倒排索引**（O(n) 全遍历 → O(候选)），可选 embedding 切 dense+BM25 RRF
- 会话压缩层 `src/memory/compaction.js`：超阈值时用 LLM 把旧对话压成结构化摘要（目标/进展/关键决策/待办/关键上下文）

### 4. 能力 seam（吸收 dsh Service|Provider|Consumer）

两层 seam：
- **工具层** `src/tools/seam.js`：Definition（元数据）/ Provider（execute）/ Consumer（`runWithPolicy` 统一策略：禁用/超时/权限/before-after 钩子/错误语义）
- **服务层** `src/seam/shell.js`：命令执行能力抽象，`LocalShellProvider` 默认实现，run_command 通过 `ctx.consume("shell")` 调用，换 provider 即换执行环境（未来沙箱/Docker）

### 5. LLM 客户端 + 重试内核

`src/llm/client.js` 多后端：`http`（默认直连）/ `openclaw` / `deepseek`（可选引擎）。
- `src/llm/retry.js`：瞬态分类重试（429/5xx/timeout + Retry-After + 可取消指数退避）
- `src/llm/fence.js`：纯文本工具围栏协议（openclaw/dsh 后端工具代理）
- 纯文本工具调用修复：http 后端返回文本工具意图时自动恢复为原生 tool_calls

### 6. 编排模式

`src/mode/index.js` 的 `ModeRegistry`，7 种可插拔模式：react（默认工具循环）/ single / plan-exec / router / blackboard / graph / legion。

### 7. 多 agent 军团（多进程）

`src/orchestrator/legion.js` spawn 独立 agent 子进程（`agent-worker.js`），支持 broadcast（广播取首答）/ dispatch（按角色分工）/ runDag（DAG 依赖编排）。子进程经 stdin/stdout JSON 行协议通信，step 事件实时上报进度。

### 8. 自愈引擎

`src/selfheal/healer.js`：启动体检（补建目录/修复损坏 JSON）、崩溃恢复、corrupt 备份清理。

## 目录结构

```
src/
├── agent/       Agent 引擎（编排 + 工具循环 + 多模型回退）
├── plugin/      插件装配（Context + 内置插件）
├── memory/      四层记忆 + 会话事件日志 + 压缩层
├── tools/       工具系统（catalog + seam + builtin/advanced/methods/selfmod/document/ocr）
├── seam/        服务层能力 seam（shell 等）
├── llm/         LLM 客户端（client + retry + fence + dsml + embedder）
├── mode/        编排模式（react/single/plan-exec/router/blackboard/graph/legion）
├── orchestrator/ 多 agent 军团（legion + dag + worker）
├── mcp/         MCP 客户端
├── channels/    通道（http/feishu/wechat）
├── selfheal/    自愈引擎
├── persona/     人格系统
├── skills/      方法型 Skill 加载
├── utils/       基础设施（store/logger/trace/pii）
└── config/      配置中心
```

## 数据流（一次对话）

```
用户消息 → chat()/chatStream()
  → 本地意图预判(可选) → 模式分发(react 默认)
  → buildMessages(组装 system+记忆+压缩后历史)
  → _llmWithFallback(并发健康探测 → provider 回退)
  → _llmWithTools(工具循环, 每轮发 step 事件)
      → apiChat(http 直连, 瞬态重试, 工具调用修复)
      → _runTool(工具执行, before/after 钩子, 轨迹记录)
  → 落会话事件日志 → 记忆提炼 → 场景归档 → 画像刷新
```
