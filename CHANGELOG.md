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
