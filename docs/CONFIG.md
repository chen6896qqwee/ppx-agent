# 配置说明

皮皮虾的配置在 `config/ppx.json`（或 `config/ppx.yaml`）。所有字段都有默认值，未写的字段自动用默认兜底（见 `src/config/index.js` 的 `DEFAULT_CONFIG`）。环境变量可覆盖部分项。

## 快速开始

最少配置：只设一个模型 API key 环境变量即可跑，其余全默认：

```bash
export OPENAI_API_KEY="sk-..."      # 或 DEEPSEEK_API_KEY / DASHSCOPE_API_KEY / VOLCENGINE_API_KEY
npm run chat
```

## providers（模型提供方）

数组，按顺序回退（第一个失败自动切下一个）。每个 provider 的字段：

| 字段 | 说明 |
|------|------|
| `id` | 唯一标识（如 `openai`） |
| `backend` | 后端类型：`http`（直连 OpenAI 兼容 API，默认）/ `openclaw` / `deepseek`（可选引擎） |
| `base_url` | API 端点（http 后端） |
| `api_key` / `api_key_env` | 直接填 key，或填环境变量名 |
| `model` | 模型名 |
| `vision` | `true` 标记为视觉模型（多模态读图时路由到此） |
| `timeout_ms` | 超时（毫秒，默认 120000） |
| `retry_max` | 单次调用内瞬态错误重试次数（默认 3） |
| `mjs` | openclaw 引擎的 openclaw.mjs 路径（可留空走 `PPX_OPENCLAW_MJS` 环境变量） |
| `dsh_root` | DeepSeek Harness 源码根（可留空走 `PPX_DSH_ROOT`） |

**可选引擎**：openclaw/dsh 已移出默认 providers，作为 `_optional_engines` 注释配置保留。要用时把对应对象移入 `providers` 数组（见 `docs/QUICKSTART.md` 第 5 节）。

## agent（智能体）

| 字段 | 默认 | 说明 |
|------|------|------|
| `name` | 皮皮虾 | 智能体名字 |
| `yuan` | ppx | 内部代号 |
| `localIntent` | true | 本地意图预判（高置信简单指令不调 LLM，省成本） |
| `mode` | react | 编排模式：react / single / plan-exec / router / blackboard / graph / legion |
| `citation_rule` | 引用规则 | 让 LLM 引用来源的规则文本 |
| `system_extra` | "" | 追加的 system prompt 内容 |

## user

| 字段 | 默认 | 说明 |
|------|------|------|
| `name` | 兄弟 | 如何称呼用户 |

## memory（记忆）

| 字段 | 默认 | 说明 |
|------|------|------|
| `enabled` | true | 记忆开关 |
| `token_budget` | 2500 | 记忆注入的 token 预算 |
| `decay_per_day` | 0.02 | L1 记忆高斯衰减率 |
| `hit_bonus` | 5 | 命中加分 |
| `base_importance` | 10 | 基础重要性 |
| `compile_threshold` | 4.5 | L2 场景聚类阈值 |
| `forget_speed` | 1 | 遗忘速度 |
| `max_history_items` | 40 | 会话历史条数上限 |
| `history_token_budget` | 4000 | 会话历史 token 预算（超阈值触发压缩） |
| `max_facts` | 1000 | L1 记忆总量上限 |

## embedding（可选，向量检索）

配了才能走 dense 语义检索（否则纯 BM25）：

| 字段 | 说明 |
|------|------|
| `base_url` | embedding 端点 |
| `api_key` | key |
| `model` | embedding 模型名 |

## experience / selfheal / tools / plugins

| 字段 | 默认 | 说明 |
|------|------|------|
| `experience.enabled` | true | 经验库开关 |
| `selfheal.enabled` | true | 启动自愈体检 |
| `selfheal.check_interval_ms` | 60000 | 自愈检查间隔 |
| `selfheal.max_restart_attempts` | 3 | 崩溃重启上限 |
| `tools.enabled` | true | 工具系统开关 |
| `tools.custom_dir` | custom-tools | 自定义工具目录 |
| `plugins.dir` | plugins | 插件目录 |

## mcp（MCP 工具服务器）

| 字段 | 说明 |
|------|------|
| `servers` | MCP 服务器列表（`{command, args}` 走 stdio，或 `{url}` 走 HTTP） |
| `auto_connect` | 启动时是否自动连接 |

## channels（通道）

| 字段 | 说明 |
|------|------|
| `http.enabled` / `http.port` / `http.auth_token` | HTTP 通道（空 token 时启动自动生成随机 token） |
| `feishu.*` | 飞书通道（appId/appSecret/verifyToken） |
| `wechat.*` | 企业微信通道（token/encodingAESKey/corpId/corpSecret/agentId） |

## security（安全）

| 字段 | 默认 | 说明 |
|------|------|------|
| `allow_all` | false | 放开命令白名单（危险） |
| `command_timeout_ms` | 30000 | 命令执行超时 |
| `code_act` | false | CodeAct 脚本出口（默认关闭，需显式开启） |

## 环境变量

| 变量 | 说明 |
|------|------|
| `PPX_DATA_DIR` | 数据目录（记忆/会话/经验落盘位置，覆盖默认 root/data） |
| `PPX_AUTH_TOKEN` | HTTP 认证 token |
| `PPX_PORT` | HTTP 端口 |
| `PPX_OPENCLAW_MJS` | openclaw 引擎路径 |
| `PPX_DSH_ROOT` | DeepSeek Harness 源码根 |
| `PPX_AGENT_DATA_DIR` | 军团 worker 的独立数据目录 |

## 数据目录

默认数据目录是 `root/data`（源码运行时）。**npm 全局/本地安装**（包在 `node_modules` 里）时自动外置到 `~/.ppx`，避免卸载丢数据。可用 `PPX_DATA_DIR` 显式指定。
