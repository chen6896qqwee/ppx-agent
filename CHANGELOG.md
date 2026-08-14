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
