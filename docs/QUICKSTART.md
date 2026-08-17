# 快速上手

皮皮虾 (PPX Agent) 是一个会自我修复、自我学习的超级 Agent。零运行时依赖，纯 Node 原生，支持各大模型 API + 本地模型。

## 1. 环境要求

| 项目 | 要求 |
|------|------|
| Node.js | `>=22.22.3` 且避开 `23.x` / `24.0-24.14`（推荐 26.x） |
| npm | 随 Node 自带 |

> 为什么这么挑版本？默认底座 OpenClaw 引擎要求这些下限。如果你只用纯 HTTP 模型（OpenAI/DeepSeek/通义），Node 20 也能跑，但官方支持矩阵如上。

## 2. 安装

### 方式 A：npm 安装（内核，推荐给终端用户）

```bash
npm install -g ppx-agent

ppx        # 进入对话 CLI
ppx-serve  # 启动 HTTP 服务 (http://127.0.0.1:8899)
```

### 方式 B：源码运行（需要 Web UI 或二次开发）

```bash
git clone https://github.com/chen6896qqwee/ppx-agent.git
cd ppx-agent
npm run selfheal   # 启动自愈体检
npm run chat       # CLI 对话
```

> Web UI 目前随源码仓库分发，不在 npm 包内（见下方「Web UI」）。

## 3. 配置模型

模型提供方在 `config/ppx.json` 的 `providers` 数组里，按顺序回退（第一个失败自动切下一个）。纯 HTTP 模型只需配 API key 环境变量：

```bash
# 任选其一（按你用的模型）
export OPENAI_API_KEY="sk-..."
export DEEPSEEK_API_KEY="sk-..."
export VOLCENGINE_API_KEY="..."
export DASHSCOPE_API_KEY="..."
```

不配 key 也能以「离线记忆模式」启动，只是不会真的调用模型。

内置 provider 模板：`openai` / `deepseek` / `volcengine` / `dashscope`（文本）+ `qwen-vl`（多模态）+ `lmstudio`（本地）。

## 4. 三种使用方式

### CLI 对话

```bash
ppx            # 或 npm run chat
```

命令：`quit`/`exit` 退出 · `/stop` 中断当前任务 · `/reset` 清空会话 · `↑↓` 浏览历史 · `Ctrl+C` 单次中断。

### HTTP API

```bash
ppx-serve      # 或 npm run serve / node src/server.js
```

```bash
# 健康检查
curl http://127.0.0.1:8899/health

# 对话（Bearer token 未配置时启动会自动生成随机 token 打印到控制台）
curl -X POST http://127.0.0.1:8899/message \
  -H "Content-Type: application/json" \
  -d '{"message": "你好"}'
```

### Web UI（需源码）

```bash
cd ppx-agent
npm run web:build   # 首次或前端改动后构建
npm run web         # 一条命令同时起内核(8899) + 前端(3000)
```

打开 http://localhost:3000 。前端通过代理自动连到本机 8899 内核。

## 5. 可选引擎（OpenClaw / DeepSeek Harness）

默认纯 HTTP 模型开箱即用。`config/ppx.json` 里 openclaw/dsh 已作为 `_optional_engines` 注释配置保留（默认不启用）。想切换时，把对应对象移入 `providers` 数组即可：

```json
{ "id": "openclaw", "backend": "openclaw", "mjs": "", "session_key": "ppx:main" },
{ "id": "dsh", "backend": "deepseek", "dsh_root": "" }
```

再用环境变量指定引擎位置：

```bash
# OpenClaw 引擎（需先 npm i -g openclaw，找到 openclaw.mjs）
export PPX_OPENCLAW_MJS="/path/to/openclaw/openclaw.mjs"

# DeepSeek Harness（需先 clone + pnpm install + build）
export PPX_DSH_ROOT="/path/to/deepseek-harness"
```

或在 config 对应 provider 里直接填 `mjs` / `dsh_root` 字段。

## 6. 常见问题

- **`OpenClaw 引擎未就绪: mjs 路径不存在`** → 设 `PPX_OPENCLAW_MJS`，或改用 HTTP 模型。
- **`dsh 源码未就绪`** → 设 `PPX_DSH_ROOT` 指向 clone 好的 deepseek-harness。
- **端口被占** → 内核端口用 `PPX_PORT` 改；Web UI 端口在 `web/package.json` 的 `start` 里加 `-p`。
- **数据存哪** → 运行数据（记忆/会话/经验）写在 `data/` 目录，源码运行时在仓库根，npm 安装时在包目录内。
