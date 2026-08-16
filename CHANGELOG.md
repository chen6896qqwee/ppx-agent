# CHANGELOG

## v0.4.1 (2026-08-14) — 评估报告修复 (P0/P1)

依据 `docs/EVALUATION-v0.4.md` 修复安全与工程质量问题。

### P0 安全/数据
- **HTTP 认证**: `auth_token` 为空时启动自动生成随机 token 打印到控制台 (类似 Jupyter), 不再裸奔。`src/channels/http.js`
- **请求体上限 + 限流**: 新增 1MB body 上限 + 每 IP 60 req/min 令牌桶。`src/channels/http.js`
- **SSRF 防护**: `http_request` 拦截内网/保留地址 (127/10/172.16/192.168/169.254/0/100.64)。`src/tools/advanced.js`
- **run_command 白名单精确匹配**: `startsWith` → 精确 token 匹配, 防 `node_malicious` 绕过。`src/tools/builtin.js`

### P0 测试隔离
- 修复 4 个测试文件 (agent/absorb.deepseek/advanced.tools/tools) 用真实 ROOT 污染生产 `data/` → 全部改用 `tmpRoot()` 临时目录
- 清理生产污染: facts.json 全测试数据清空, 删除 tmp-skills, 清理 l0 测试会话行
- 新增 `test/session.test.js` 覆盖会话持久化

### P1 会话持久化
- 新增 `src/memory/session.js` (SessionStore): 会话 JSONL 落盘 `data/sessions/<key>.jsonl`, 重启不丢
- `agent/index.js` 接入: 构造加载, `_pushTurn` flush, `resetSession` 同步删文件

### 杂项
- README: 工具清单 11→24, 补认证/SSRF/会话/测试隔离特性, 修乱码
- 修复 agent/index.js 5 处注释乱码

### 验证
- 测试: 58 过 0 失败 2 跳过 (网络型) + channels 3 过
- LLM 链: 本机 Node v26.4.0 满足 OpenClaw (>=25.9.0), `通了` 实测通过


## v0.4.2 (2026-08-14) — 测试修复 + fetch_page + Provider 健康探测

### 修复
- **channels 测试**: 固定端口(EADDRINUSE) + 缺少鉴权 token(401) → 改动态端口(0) + 读取自动生成的 authToken。`test/channels.test.js`
- **测试全绿**: 67 测试 65 过 0 失败 2 跳过(网络型)

### 新增
- **fetch_page 工具**: 抓网页正文转纯文本(去 script/nav/footer, 截断), 复用 httpRequest 的 SSRF 防护, 配合 web_search 让 agent 能读网页内容作答。`src/tools/advanced.js`
- **LLMClient.health()**: 并发健康探测 — openclaw 后端校验 Node 版本(>=22.22.3/>=24.15/>=25.9), http 后端 3s 探测 /models。`src/llm/client.js`
- **_llmWithFallback 并发探测**: 多 provider 时先并发 health() 跳过不可用项, 避免串行等待 180s 超时(最坏 15 分钟 → 秒级)。`src/agent/index.js`

### 验证
- 新增 test/fetch-page.test.js + test/health.test.js


## v0.4.3 (2026-08-14) — 记忆倒排索引 + Web UI 体验优化

### 记忆检索升级 (文档4方向4, P2-1)
- **fact-store 倒排索引**: 字符级索引(中文单字+英文token) -> Set<factId>, 检索 O(n) 全遍历 -> O(候选)。`src/memory/fact-store.js`
- 新增 `rebuildIndex()` 支持外部变更后重建
- 阈值保护: 候选过散(命中常见字)自动回退全量, 防索引退化; 无命中同样回退全量保证召回
- 新增 test/inverted-index.test.js (5 用例)

### Web UI 体验优化 (P2-5)
- **主题跟随系统**: 固定暗色 -> `prefers-color-scheme` 深浅两套 CSS 变量, 自动适配 light/dark IDE
- **marked 本地化**: 下载 marked.min.js 到 public/vendor/, 离线可用, 不再依赖 CDN
- **场景新建改表单**: prompt() 弹窗 -> modal 表单(名称/介绍/能力), 支持 Esc/点遮罩关闭
- **移动端响应式**: 窄屏(<=768px)侧栏变抽屉, 右上角"面板"按钮切换
- **http.js 通用静态服务**: 支持 public/ 子目录(vendor/), 含路径穿越防护
- 修复 esc() 重复定义

## v0.5.1 (2026-08-15) — 评估报告修复 (EVALUATION-v0.5 P0/P1)

依据 `docs/EVALUATION-v0.5.md` 修复。

### P0 — 环境一致性
- **Node 版本声明统一**: `package.json` engines 从 `>=20.0.0` 改为实际要求 `>=22.22.3 <23 || >=24.15 <25 || >=25.9` (OpenClaw 引擎真实下限, 且明示 23 与 24.0-24.14 不支持)。`package.json`
- **health.test.js 参数化**: 抽纯函数 `nodeVersionOk(version)` 导出 (client.js), health() 复用之; 测试不再硬编码当前环境版本断言, 改为版本矩阵参数化, 消除环境可移植性缺陷。`src/llm/client.js` `test/health.test.js`

### P1 — 体验与质量
- **LLM 失败引导**: openclaw 后端新增 `_openclawReadyOrThrow()` (启动前校验 Node 版本, 不满足抛中文引导) + `_translateOpenclawError()` (将 CLI 版本类报错译为"请升级 Node 至 >=22.22.3 (推荐 26.x)"), 替代原始报错。`src/llm/client.js`
- **记忆内容去重**: `FactStore.add()` 前按归一化内容 (去空白折叠) 比对, 相同内容已存在则命中加分而非重复新增; 覆盖 addMemory/recordTurn/schedule 笔记。`src/memory/fact-store.js`
- **corrupt 备份自动清理**: Healer 新增 `cleanupCorruptBackups(keep=2)`, heal() 启动时保留最近 2 个 `.corrupt-*` 备份, 更早自动删除。`src/selfheal/healer.js`

### 语言一致性
- 修复 `src/agent/index.js:22` 注释乱码 (`????? token ??????` → `会话历史 token 预算`)
- README 14 处 `??` 残留清零 (→ ✅), 特性标题乱码修复 (→ ✨)

### 验证
- 全量测试: 73 个, 71 通过 / 0 失败 / 2 跳过 (网络型)。上轮唯一 health 失败已修复
- 实测: 记忆去重 (相同2条→1条, 不同仍新增)、corrupt 清理 (3→2)

> 未含 openclaw 后端真实流式 (P1-3): openclaw CLI 非流式, 需引擎侧 SSE 支持, 暂保留一次性返回。

## v0.5.2 (2026-08-15) — DeepSeek Harness 底座整合

对比 deepseek-ai/deepseek-harness (110k★, Cordis 插件化 Agent 框架) 后，把 dsh 一次性运行器作为皮皮虾的 LLM 底座后端接入（与既有 OpenClaw 后端并列，可按 provider 切换）。

### 新增 DeepSeek Harness 后端
- **`src/llm/client.js`**: 新增 `deepseek` 后端 (provider `backend: "deepseek"` 或 `id: "dsh"`)。
  - `_dshChatAsync()`: 驱动 `node --import tsx/esm apps/cli/src/bin.ts --profile headless "<task>"`，stdout 提取最终助手文本，exit 0=turn 完成 / 1=出错(stderr 带错误)
  - `_dshReadyOrThrow()`: dsh 源码缺失时抛中文引导
  - `health()`: 校验 dsh 源码存在 + Node 版本
  - `chat/apiChat/streamChat` 均接入 deepseek 分支
- **`src/agent/index.js`**: `_resolveAllLLMs`/`_resolveLLM` 纳入 dsh 后端 (backend=deepseek / id=dsh)
- **`config/ppx.json`**: 新增 `dsh` provider (dsh_root 指向桌面源码)

### dsh 源码落地
- `C:\Users\chen\Desktop\deepseek-harness` (master, 7441 文件)
- 已 `pnpm install` + `pnpm run build:lib:host`（headless 不需 web 前端）
- 跑通: `dsh --profile headless` 全链路 14s 返回 (DEEPSEEK_API_KEY)

### 验证
- dsh headless 直连: 返回正常, exit 0
- 皮皮虾 dsh 后端: health=true, chat 13.8s 返回
- 皮皮虾全量测试: 73 个 71 过 0 失败 2 跳过

### 待办
- dsh 首次启动需先 `pnpm install` + `pnpm run build:lib:host`（构建产物在 lib/，typert loader 依赖）
- 底座切换: 想让皮皮虾用 dsh 当大脑，把 openclaw provider 移到 dsh 之后或临时注释掉

## v0.5.3 (2026-08-15) — openclaw + DeepSeek Harness 合并为统一底座

把 openclaw 后端与 deepseek(dsh) 后端合并成一个 `combined` 底座: 一个大脑按优先级驱动多个 CLI 引擎, 健康探测 + 自动回退。openclaw / deepseek 单引擎后端保留可用。

### 新增 combined 底座
- **`src/llm/client.js`**: `backend: "combined"` 时构建 `subClients` (provider.engines 数组), 新增 `_combinedCall(fn)`:
  - 先并发 health() 过滤不可用引擎, 全挂则按原顺序兜底
  - 依次调用, 失败自动回退下一个, 抛最后错误
  - chat / apiChat / streamChat / health 全部接入 combined 分支
- **`config/ppx.json`**: 新增 `brain` provider (backend=combined, engines=[openclaw, dsh]), 排第一为默认底座
- **`test/combined.test.js`**: 新增 5 个合并底座单元测试 (subClients 构建/health/无engines引导/失败回退/顺序短路)

### 验证
- 合并底座: health=true, chat 14.9s 走 openclaw 正常返回
- 故障回退实测: openclaw 引擎故意损坏 -> 自动切 dsh -> 13.1s 正常返回
- 皮皮虾全量测试: 78 个 76 过 0 失败 2 跳过

### 说明
- combined 让 openclaw 和 dsh 互为冗余, 一个引擎挂了自动切换, 皮皮虾对话不中断
- 想单独用某个引擎时, 仍可用 backend=openclaw / backend=deepseek 的单引擎 provider

## v0.6.4 (2026-08-16) — Web UI 工具调用可视化 (EVALUATION-v0.6-final P1#7)

### P1#7 工具调用过程可视化
- agent: 新增 setToolEvent() 回调 + _runTool 触发 start/done 事件 (工具名/参数/耗时/状态/结果), 供 Web UI 推送
- agent.chatStream 改造: 从纯流式改为优先走 _llmWithTools 工具循环 (能触发 onTool 事件), 最终结果一次推送; 失败降级 streamChat 流式, 再降级非流式 chat
- http.js /message/stream: 新增 onTool 回调, 推送 SSE type:"tool" 事件
- Web UI: send() 处理 tool 事件, 显示工具调用卡片 (⏳调用中→✓完成/✗失败, 含参数+耗时+结果摘要)

### 验证
- 全量测试: 104 个 101 过 0 失败 3 跳过 (网络 gate)
- 新增 tool-vis.test.js (2) 覆盖 chatStream 工具循环 + onTool 事件

## v0.6.3 (2026-08-16) — Web UI 多会话管理 (EVALUATION-v0.6-final P1#6)

### P1#6 多会话管理
- SessionStore.list(): 列出所有会话 (key/count/lastTs/标题), 按 lastTs 倒序
- SessionStore.rename(): 复制事件到新 key 删旧 key, 保留 seq 顺序
- http.js: 新增 GET /sessions (列表)、POST /sessions/rename、POST /sessions/delete
- Web UI: 侧栏新增"会话"tab, 支持新建/切换/删除/重命名会话, 显示条数+时间+标题

### 验证
- 全量测试: 102 个 99 过 0 失败 3 跳过 (网络 gate)
- 新增 session-manage.test.js (3) 覆盖 list/rename/delete

## v0.6.2 (2026-08-16) — 评估报告 P1 修复 (EVALUATION-v0.6-final)

### P1 修复
- **notify 工具描述中文化** (P1#8): advanced.js 的 notify 描述由英文改为中文, 统一工具描述语言
- **会话日志增量落盘** (P1#5): session.js _flush 由全量重写改为 appendFileSync 增量追加, 用 _flushedSeq 追踪已落盘进度; 首次/重建时全量覆盖, 消除大会话(1000+条)写放大
- **AML 限流对齐** (P1#10): aml-server.js 新增 60 req/min 令牌桶限流(对齐 http.js), 超限回 429; 顺带修复 readBody 超限时 req.destroy() 导致客户端 ECONNRESET 而非 413 的真实 bug
  - aml-server 导出 createAmlServer() 供测试进程内起停, CLI 入口保留

### 验证
- 全量测试: 99 个 96 过 0 失败 3 跳过 (网络 gate)
- 新增 session-append.test.js (3, 增量落盘跨实例) + aml-server.test.js (3, Add/Search/413/限流)

## v0.6.1 (2026-08-16) — 评估报告 P0 修复 (EVALUATION-v0.6-final)

### P0 修复
- **openclaw/dsh 后端工具调用代理**: 新增 src/llm/fence.js 围栏协议。openclaw/dsh 是外部进程无法直调 PPX 内部工具, 现通过围栏语法 (\u27ea tool:name \u2502 {json} \u27eb) 让引擎以纯 LLM 输出工具意图, client 解析执行 PPX 工具并喂回结果, 收敛后返回最终回复。agent 层零改动, 与 http 原生 tool_calls 并存。
  - parseToolFence / buildFencePrompt / proxyToolLoop 纯函数, 独立可测
  - LLMClient.apiChat 新增 toolRunner 参数; openclaw/dsh 后端有 toolRunner 时走代理循环, 否则退化纯 LLM
  - agent/index.js 新增 _runTool 统一工具执行入口 (trace 记录)
- **hardcoded 路径外部化**: DEFAULT_DSH_ROOT / DEFAULT_MJS 改为环境变量 PPX_DSH_ROOT / PPX_OPENCLAW_MJS, 缺失回退内置默认
- **dead code 确认**: _queryJaccard / _jaccard 已在前序版本清理, 报告基于旧快照, 无需处理

### 验证
- 全量测试: 93 个 90 过 0 失败 3 跳过 (网络 gate)
- 新增 fence.test.js (9) + tool-proxy.test.js (2) 覆盖围栏解析与代理循环

## v0.6.0 (2026-08-15) — 新架构: 吸收 DeepSeek Harness 设计原则 + openclaw 为唯一底座引擎

应兄弟要求: 不要套两个引擎的路由器, 而是吸收两者优势合并成一个新架构。定案:
**一个底座 (新架构内核) + 一个可插拔引擎接缝 (openclaw 默认)**。

### 吸收 dsh 的三大设计原则
1. 会话即唯一事实源 (model-visible means logged): src/memory/session.js 从覆盖式 JSONL 重写为不可变 append-only 事件日志 (每条 seq/ts/type/data)。
   - 模型可见历史 = deriveMessages() 从日志投影 (无可变状态, 仅从日志重建)
   - replay() 回放完整事件流 | fork() 从边界派生新会话 | 事件域 user/assistant/system/tool
   - 老格式文件优雅跳过 (不崩), 新写自动用事件格式
2. 引擎 = 可插拔接缝 (Service|Provider|Consumer): LLM 后端 (openclaw/deepseek/http) 是单一底座后面的可换服务, 由 config provider 决定, 不再有组合路由器
3. 分层配置可覆盖: config provider 顺序即优先级, 引擎可换

### 架构收敛
- 移除 combined wrapper (两个引擎的路由器, 违反单个底座), 删除 test/combined.test.js
- 唯一默认底座引擎 = openclaw (config 第一), deepseek(dsh) 保留为可换的后端接缝
- src/agent/index.js: _pushTurn 改为 append 事件, _loadHistory/_getSession 改为 deriveMessages + 投影层裁剪

### 验证
- 会话事件日志: append 不可变 / derive 投影 / replay / fork / 跨实例恢复 全测过
- 全量测试: 76 个 74 过 0 失败 2 跳过
- 旧 default.jsonl 新格式正常加载, 旧 eval-test 格式优雅跳过