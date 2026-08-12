# 🦐 皮皮虾 (PPX Agent) 测试版

**一个会自我修复、自我学习的超级 Agent。** 零运行时依赖，纯 Node 原生，支持各大模型 API + 本地模型。

> 架构参考 openhanako/HanaAgent 与 TencentDB-Agent-Memory，扒其记忆分层、自愈内核、工具系统的精华，用干净自包含实现重搭。

## ✨ 特性

| 能力 | 说明 |
|------|------|
| 🧠 **腾讯式四层记忆** | L0原始对话 → L1原子记忆(高斯衰减) → L2场景 → L3核心画像 |
| 🔧 **11个内置工具** | 文件/命令/搜索/HTTP/定时/记忆检索 |
| 🩺 **自我修复** | 启动体检、损坏JSON自动修复、崩溃恢复、残留清理 |
| 📚 **自我学习** | 经验库 + 自动提炼用户画像/agent人格 |
| 🤖 **多 Agent 军团** | 多进程并行，broadcast/dispatch 分工协作 |
| 🔌 **多渠道接入** | HTTP(可用) + 飞书/微信(框架) |
| ?? 上下文压缩 | 长对话自动滚动摘要, 防 token 失控 |
| ?? 错误自愈 | 工具错误统一语义, 自动重试修正 |
| ?? 方法型Skill | humanize去AI味 / write_article分阶段写作 / clarify需求澄清 |
| ?? 可观测 | 工具调用轨迹JSONL + 失败率/慢工具统计 |
| ?? LLM真摘要 | 长对话自动LLM语义摘要, 非堆叠 |
| ?? 场景系统 | 灵魂文件式场景(手动设定/历史提炼), 命中自动切换行为 |
| ?? Next.js产品壳 | web/ 前端代理8899内核, 聊天+场景+记忆+轨迹+统计 |
| ☁ **多轮对话历史** | 会话内上下文连续, 滚动截断控 token (P0 修复) |
| ?? **流式输出** | SSE 逐字流式, Web UI 实时渲染 (P1) |
| ?? **命令安全** | run_command 黑白名单+高危拦截 (P0 修复) |
| ?? **HTTP 认证** | Bearer Token 可选, 保护 /message + /api (P1) |
| ?? **Markdown 渲染** | Web UI marked.js 渲染代码块/列表 (P1) |
| ?? **多模型 API 优先** | OpenAI/DeepSeek/火山/通义 + 本地模型兜底 |

## 🚀 快速开始

```bash
# 1. 配置模型 (config/ppx.json)
#    设置环境变量: OPENAI_API_KEY / DEEPSEEK_API_KEY / VOLCENGINE_API_KEY ...

# 2. 启动自愈体检
# 3. 启动产品壳 (Next.js, 需先启动内核): cd web && npm run dev # http://localhost:3000
npm run selfheal

# 3. 启动对话 (CLI)
npm run chat

# 4. 启动 HTTP 服务
node src/server.js   # http://127.0.0.1:8899

# 5. 跑测试
npm run test
```

## 🔌 模型接入 (API 优先)

皮皮虾支持任意 **OpenAI 兼容端点**, 自动多 provider 回退:

```json
{
  "providers": [
    { "id": "openai",     "base_url": "https://api.openai.com/v1",              "api_key_env": "OPENAI_API_KEY",     "model": "gpt-4o-mini" },
    { "id": "deepseek",   "base_url": "https://api.deepseek.com/v1",             "api_key_env": "DEEPSEEK_API_KEY",   "model": "deepseek-chat" },
    { "id": "volcengine", "base_url": "https://ark.cn-beijing.volces.com/api/v3", "api_key_env": "VOLCENGINE_API_KEY", "model": "<你的endpoint>" },
    { "id": "dashscope",  "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "api_key_env": "DASHSCOPE_API_KEY", "model": "qwen-turbo" }
  ]
}
```

**回退机制**: 第一个 provider 失败自动切换到下一个, 直到成功。API 全挂时可用本地 LM Studio 兜底:

```json
{ "id": "lmstudio", "base_url": "http://127.0.0.1:1234/v1", "api_key": "lm-studio", "model": "gemma-4-e2b" }
```

## 🧠 记忆架构 (L0 → L3)

```
对话 → L0 原始对话(JSONL) → L1 原子记忆(高斯衰减) → L2 场景(关键词聚类) → L3 画像(persona)
```

- **L0**: `data/memory/l0/YYYY-MM-DD.jsonl`, 每日一个文件, 过滤噪音
- **L1**: `facts.json`, score = score × exp(-λt²), 命中加分
- **L2**: `scenes.json`, 相关记忆聚类成场景
- **L3**: `user.persona.md` + `agent.persona.md`, 从记忆提炼画像

## 🩺 自我修复

- 启动体检: 补建缺失目录 / 修复损坏JSON(备份后重建)
- 崩溃恢复: 检测异常退出, 清理残留临时文件
- 数据一致性: integrity 标记, 干净退出/异常退出可感知

## 📂 目录结构

```
ppx-agent/
├── config/         配置 (ppx.json + identity/ishiki 人格)
├── src/
│   ├── agent/      Agent 引擎 (编排 + 工具循环 + 多模型回退)
│   ├── memory/     L0-L3 四层记忆 + 经验库
│   ├── selfheal/   自愈引擎
│   ├── tools/      工具系统 (11个)
│   ├── channels/   通道 (http/feishu/wechat)
│   ├── orchestrator/ 军团编排器 (多进程)
│   ├── llm/        LLM 客户端
│   └── utils/      基础设施
├── data/           运行时数据 (不进 git)
├── test/           测试 (38 个全过)
└── docs/           文档
```

## 📄 License

Apache License 2.0

## 🙏 架构来源

- [openhanako (HanaAgent)](https://github.com/liliMozi/openhanako) — 记忆分层、自愈内核、人格系统
- [TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) — L0-L3 四层记忆架构
- [OpenClaw](https://openclaw.ai) — agent 运行时组织