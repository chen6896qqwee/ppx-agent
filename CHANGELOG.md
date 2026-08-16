# CHANGELOG

## v0.10.3 (2026-08-16) — 模型配置 Web UI (DSH 风格首启向导)

补上"首启即可视化配置 LLM 提供方", 用户不再需要手改 `config/ppx.json`。

### 后端: 提供方 CRUD + 热重载
- **`src/config/providers.js`** (新建): 提供方 CRUD (load/validate/sanitize/add/update/remove/reorder) + 原子写盘 + .bak 备份 (保留最近 3 个)
- **`src/channels/http.js`**: 新增 6 个路由
  - `GET    /api/providers`        列表 (key 抹掉, 只返 api_key_set 标志)
  - `POST   /api/providers`        新增 (body: { provider: {...} })
  - `PUT    /api/providers`        更新 (body: { id, patch })
  - `DELETE /api/providers`        删除 (body: { id })
  - `POST   /api/providers/test`   健康探测 (复用 agent LLM 客户端 → 兜底从磁盘构造)
  - `POST   /api/providers/reorder` 重排 (默认 = 第 0 个)
- **`src/agent/index.js`**: `reloadProviders()` 方法, 写盘后立即重建 `this.llm` / `this.allProviders`, 无需重启
- **`src/server.js`**: 测试 stub 注入同步覆盖 `allProviders`, 让 /test 路由也能命中 stub

### 前端: 设置子路由 + 首启引导
- **`web/src/lib/api.ts`** (新建): fetch 封装 + Bearer token 处理 (localStorage)
- **`web/src/app/settings/layout.tsx`** (新建): 设置页布局, 左侧子导航 (模型 / 通用 / 插件 / Agent 预设)
- **`web/src/app/settings/model/page.tsx`** (新建): 模型设置主面板
  - 提供方卡片列表 (状态点: 绿=就绪 / 红=未配)
  - 编辑 / 删除 / 测试连接 按钮
  - "+ 添加提供方" (6 个常用模板: OpenAI/DeepSeek/通义/火山/Qwen-VL/LM Studio)
  - "+ 添加自定义提供方" (任意 OpenAI 兼容端点)
- **`web/src/app/settings/{general,plugins,presets}/page.tsx`** (新建占位): 三栏子页面占位, 后续按需补
- **`web/src/app/page.tsx`**: 头部加"设置"链接 + 首启引导横幅 (无任何就绪提供方时, 顶部红条提醒 + "前往配置"按钮)

### 验证
- 全量测试: 263 项 260 过 0 失败 3 跳过 (新增 21 项: validate/sanitize/CRUD/HTTP API/鉴权/测试连接, 用 tmp 根隔离生产数据)
- 改动即热重载: API 写完磁盘后 agent 立即重建客户端, 不需重启进程

## v0.10.2 (2026-08-16) — 全面完善: 扫描件自动 OCR + 防注入 + CLI 升级

收掉验收报告 (ACCEPTANCE-v0.9.2) 的代码层风险项 R2/R3/R4 + 扫描件自动 OCR。

### 扫描件 PDF 自动 OCR
- `extractPdfJpegs` 提取 PDF 内嵌 JPEG (DCTDecode) 图片; `readDocumentText` 对无文本层 PDF 自动提取图片 → OCR (可注入测试)。`src/tools/document.js`
- `read_document` / `ingest_document` 自动走 OCR; `config.ocr.auto = false` 可显式关闭
- PDF 文本解码增强: `decodePdfString` 支持 UTF-16BE (FE FF BOM) 与 UTF-8, 修中文乱码

### Prompt Injection 防护 (R2)
- `config/ishiki.md` 新增「安全边界」: 不泄露系统提示词/人格/配置, 忽略「忽略指令/扮演新角色」注入, 不外发内部信息

### CLI 升级 (R3/R4)
- `src/cli.js` 重写: node:readline 历史 (↑↓浏览) + `/stop` 中断 + `/reset` 清会话 + Ctrl+C 单次中断(再按退出) + busy 防重入
- interrupt 状态自动复位: `chat()`/`chatStream()` 开头 `clearInterrupt()`, 修中断状态残留 bug

### 验证
- 全量测试: 220 项 217 过 0 失败 3 跳过 (网络 gate)。
- 新增: extractPdfJpegs / 扫描件自动 OCR(注入 mock) / 文字型 PDF 不误触发 OCR / interrupt 复位。

## v0.10.1 (2026-08-16) — OCR 文字识别 (扫描件/图片)

补上 PDF 扫描件的缺口: OCR 识别图片里的文字。

### OCR (零依赖, 可插拔)
- **`src/tools/ocr.js`**: `ocrImage` 主通道本地 tesseract (零 key 零网络) + 百度 OCR 云回退。
  - `tesseractAvailable` 检测本地 tesseract (本机已装 v5.5.0 含 chi_sim 中文包)
  - `ocrWithTesseract` 调 tesseract 二进制输出识别文字
  - `ocrWithBaidu` 百度通用文字识别 (access_token + general_basic)
  - 都不可用抛中文引导
- **`ocr_image` 工具**: 识别图片/扫描件文字 (config.ocr 可配 tesseract 路径/lang/云 key)。`src/tools/document.js`

### 验证
- 全量测试: 216 项 213 过 0 失败 3 跳过 (网络 gate)。
- 新增 test/ocr.test.js (6): tesseract 检测/识别逻辑/云回退/中文引导/路径越界。
- 真实冒烟: 本机 tesseract 可用, OCR 调用链路真实走通。

## v0.10.0 (2026-08-16) — 文档加载 + RAG (对标 LangChain Document Loaders)

补上对标 LangChain 缺失的两块: 文档加载器 + 向量检索接入。

### 文档加载器 (零依赖)
- **`src/tools/document.js`**: `extractDocumentText` 按扩展名提取 txt/md/json/csv/html/pdf 纯文本。
  - PDF 零依赖提取: zlib 解压 FlateDecode 流 + 提取 Tj/TJ 文本操作符 (文字型 PDF, 扫描件需 OCR)
  - html 去 script/style 标签; `splitChunks` 按段落分块 (~500 字)
- **`read_document` 工具**: 读本地文档转纯文本 (复用 safePath 防路径穿越)

### 向量检索接入 (可选)
- **`src/llm/embedder.js`**: `createEmbedder` 从 `config.embedding` 读 OpenAI 兼容 embedding 端点 (零依赖 fetch), 返回 embed 函数。
- **自动注入**: toolsPlugin 启动时配了 `config.embedding` 则 `facts.setEmbedder`, 记忆检索自动切 dense cosine + BM25 RRF 融合; 不配则纯 BM25 + LLM 扩展兜底。

### RAG 入库闭环
- **`ingest_document` 工具**: 读文档 → 分块 → 写入 FactStore (带 scope 来源标签, 与对话记忆同库统一检索)。

### 验证
- 全量测试: 210 项 207 过 0 失败 3 跳过 (网络 gate)。
- 新增 test/document.test.js (9): txt/md/html/pdf 提取 / 分块 / read_document / ingest_document / embedder。

## v0.9.2 (2026-08-16) — P0 工程收尾 (版本号/残留清理/自愈修复)

### 修复
- **版本号同步**: `package.json` `version` 0.1.0-beta → 0.9.1 (与真实版本脱节 9 个小版本)
- **自愈 corrupt 清理 bug**: `Healer.cleanupCorruptBackups` 定义了但 `heal()` 从未调用, 导致 `.corrupt-*` 备份持续累积。修复: `heal()` 内自动调用, 保留最近 2 个。`src/selfheal/healer.js`
- **清理 data/ 残留**: corrupt 备份 6 → 2 (保留最近 2 个), 无 tmp/bak 残留

### 验证
- 全量测试: 201 项 198 过 0 失败 3 跳过 (网络 gate)。
- 新增 test/selfheal-cleanup.test.js (2): 自动清理保留最近 2 / 不足 2 不误删。

## v0.9.1 (2026-08-16) — 多模态读图接通 (视觉模型接入)

把「多模态为零」补齐为可用的读图链路。此前 read_image 工具 + toToolContent 转 image_url 块存在, 但图片落在 tool 消息里 (OpenAI 视觉 API 要求图片在 user 消息), 且没有视觉模型。

### 多模态链路
- **图片自动注入**: `_visionUserContent` 扫描 user 消息里的图片路径 (png/jpg/gif/webp/bmp), 同步读图注入为 OpenAI 视觉格式的 `[{type:text},{type:image_url}]` content 数组。`src/agent/index.js`
- **视觉路由**: `_llmWithFallback` / `chatStream` 检测到消息含 image_url 块时, 优先路由到 `vision: true` 的 provider (否则图片发到文本后端浪费)。`src/agent/index.js`
- **provider 标记**: `LLMClient` 新增 `vision` 字段 (provider.vision)。`src/llm/client.js`
- **纯函数复用**: `imageFileToDataUrl` 抽出, read_image 工具与图片注入共用。`src/tools/builtin.js`
- **视觉模型接入**: config 新增 `qwen-vl` provider (qwen-vl-max, vision: true, DASHSCOPE_API_KEY)。`config/ppx.json`
- buildMessages / chatStream 统一走 `agent._userContent()` 组装 user 消息。`src/mode/index.js`

### 用法
对话中说「看这张图 ./screenshot.png 里有什么」即可, 图片自动读入 + 路由到视觉模型。openclaw/dsh 是文本围栏不传图, 图片只走 http+vision 后端。

### 验证
- 全量测试: 199 项 196 过 0 失败 3 跳过 (网络 gate)。
- 新增多模态用例: imageFileToDataUrl / _userContent 注入 / 无 vision 回退 / _visionLLM 路由 (test/multimodal.test.js)。

## v0.9.0 (2026-08-16) — 路线图收尾: 微信/沙箱/军团模式/自我进化

依据 `docs/EVALUATION-v0.8.2.md` 的 P1/P2 剩余项, 一次性收尾四个离线可做的硬骨头。

### P1 微信通道收尾 (半成品 → 完整)
- **主动推送 send()**: 企业微信应用消息 API (gettoken + message/send), 需 corp_id + corp_secret + agent_id。`src/channels/wechat.js`
- **加密模式被动回复**: 新增 `encryptReplyXml()` 生成含 MsgSignature/TimeStamp/Nonce 的加密回包; 加密 webhook 解密处理后自动加密回包。`src/channels/wechat-crypto.js`
- **config 补字段**: `channels.wechat.{path,token,encodingAESKey,corpId,corpSecret,agentId}` + `channels.feishu.{appId,appSecret,verifyToken}`。`src/config/index.js` `config/ppx.json`

### P1 code_act 沙箱化 (进程级加固)
- **干净环境变量**: `sandboxEnv()` 白名单只留运行必需变量, 剥离一切 API_KEY/TOKEN/SECRET/凭证, 防脚本窃取宿主凭据。`src/tools/builtin.js`
- **node 内存上限** `--max-old-space-size=256` + 输出上限 512KB + `windowsHide` + 超时强杀进程树。
- 真正隔离需外部 Docker/MicroVM, 文档注明 (见 docs/CONFIG.md)。

### P2 多 Agent 军团模式接入 mode 系统
- 新增 `src/mode/legion.js`: `legionExecutor` 懒建 Legion (缓存到 agent._legion), workflow 走 DAG 编排, 否则 broadcast 取首答。
- `PPXAgent` 支持 `dataDir` 覆盖 + `agent-worker.js` 用 `PPX_AGENT_DATA_DIR` 隔离军团数据目录 (修 worker 读取未使用的半成品)。
- mode 注册 6 → 7 个 (react/single/plan-exec/router/blackboard/graph/legion)。`src/plugin/builtin.js`

### P2 自我进化闭环补全 (轨迹 → 经验 → Skill)
- 新增 `PPXAgent.refineSkill()`: 成功轨迹 → 高频成功工具模式 → LLM 提炼 → 复用 create_skill 落盘。与 refine() (失败→经验) 互补。`src/agent/index.js`
- 新增 `refine_skill` 工具, 供 LLM 主动触发自我进化。`src/tools/selfmod.js`

### 验证
- 全量测试: 195 项 192 过 0 失败 3 跳过 (网络 gate)。
- 新增 test/wechat-channel.test.js (5) + test/legion-mode.test.js (4) + 微信加密回包/沙箱/refineSkill 用例。

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

## v0.6.5 (2026-08-16) — 记忆主动提炼 (EVALUATION-v0.6-final P1#9)

### P1#9 记忆主动提炼 (LLM 结构化)
- memory-ticker: recordTurn 新增 extractor 通道。命中信号预筛(_hasSignal)时调 LLM 结构化提炼关键事实/偏好/待办, 替代简单启发式 addMemory
  - _hasSignal: 关键词信号(我喜欢/记住/偏好/股票/仓位/工作等)或整轮>40字非寒暄才触发, 省成本
  - 无 extractor 或提炼为空时退回原启发式 addMemory
- agent: 新增 _extractMemory(user, assistant) 用 LLM 提炼, 解析 JSON 数组; 启动时 setExtractor 注入

### 验证
- 全量测试: 107 个 104 过 0 失败 3 跳过 (网络 gate)
- 新增 memory-extract.test.js (3) 覆盖高/低信号触发与退回

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