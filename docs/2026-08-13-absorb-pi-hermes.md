# 2026-08-13 吸收 Hermes v0.20 + Pi + 安装 Serena/Ponytail

## 一、安装

### Serena (oraios/serena, ★27.9k) — The IDE for your coding agent
- Python MCP 服务, 提供语义检索/编辑/重构/调试工具, 符号级操作。
- 安装: `pip install serena-agent`, 运行: `serena start-mcp-server`。
- 踩坑: Python 3.14 无 pyyaml 6.0.2 预编译 wheel, 源码编译需 MSVC(本机无编译器)卡死。
  解法: 用 Astral CPython 3.12.13 建独立 venv `.deps/serena-venv`, 走 cp312 wheel 全绿。
- 接线: 注册为 OpenClaw MCP server (`openclaw mcp add serena ...`), 皮皮虾驱动 `openclaw agent` 时自动获得 Serena 工具。

### Ponytail (DietrichGebert/ponytail, ★101k) — lazy senior dev mode
- 反过度设计哲学: 梯子原则(YAGNI->复用->stdlib->native->已装依赖->一行->最小代码)。
- 安装: 6 个技能(skills/ponytail{,audit,debt,gain,help,review})拷入皮皮虾 skills/。
- 有 Hermes 版插件(neptun-zuti/ponytail-hermes)可另行接入。

## 二、吸收 (皮皮虾内化)

### 取自 Hermes v0.20 (NousResearch/hermes-agent, ★229k)
1. 主动通知(干完活通知你): → 新增 `notify` 工具 + agent.setNotify(cb) + 工具型 turn 完成后自动 notify。
   - src/tools/advanced.js 加 notify 工具; src/agent/index.js 加 _notifyCb/notify()/setNotify()。
2. 打断(喊停): → 线程/任务级 interrupt。agent.interrupt()/clearInterrupt(), _llmWithTools 每轮开头检查。
   - 注意: Hermes 用线程级标志(多 session 并发互不影响), 皮皮虾单 agent 用实例级标志即可。
3. 带出处(可查证不吹牛): → _context() 加 CITATION_RULE, 要求引用 web_search/http_request 时标注来源 URL, 不编造。
   - Hermes 实现: provenance 追踪(hub lock file / skill write-origin), 已记入设计参考。
4. (未落地)语音/喊醒/打断: Hermes 用 tools/neutts_synth.py(TTS) + tools/interrupt.py。皮皮虾语音走 sherpa-onnx-tts skill,
   打断靠 OpenClaw 引擎已有能力, 皮皮虾侧不重复造轮子。

### 取自 Pi (earendil-works/pi, ★89k, agent harness)
- 有价值但皮皮虾已覆盖/或由 OpenClaw 承接: 统一多 provider LLM API(pi-ai), agent-loop(pi-agent-core),
  telemetry(pi-telemetry vs 皮皮虾 trace.js), TUI(pi-tui vs web 壳)。
- 待加强(记设计参考): session JSONL 存储 + compaction 摘要(branch-summarization)+ 文件操作追踪(readFiles/modifiedFiles)。
  皮皮虾目前 MAX_SESSION_HISTORY=20 截断, 未来可升级为 Pi 式摘要压缩代替硬截断。
- Pi 的 delegate 隔离模式(DELEGATE_BLOCKED_TOOLS: 禁递归/禁止改共享记忆/禁跨平台副作用)值得抄, 皮皮虾 Legion 派发时应用。

## 三、未做(诚实交代)
- Serena 的 MCP 注册(openclaw mcp add)待 venv 装完执行验证。
- 语音唤醒/打断的完整链路(依赖硬件/TTS, 超出本次范围)。
- Pi 式会话压缩(需重写 session store, 过度优化的风险, 记录为未来项)。

## 验证
- node --test: 44 原有 + 2 新增 absorb.hermes.test.js = 46 全过。
- notify 工具端到端: 注册->调用->sink 收到。
