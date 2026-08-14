# 2026-08-14 吸收 deepseek-harness 架构 — 方案

## 目标
不换底座(继续 OpenClaw)。把 deepseek-harness 的插件架构理念**务实吸收**进皮皮虾零依赖内核,提升工具系统可扩展性 + 自我修改能力。

## 吸收三理念(落地)
| deepseek 理念 | 皮皮虾落地 | 文件 |
|---|---|---|
| Capability Seam 能力缝(Definition/Provider/Consumer 三分) | 升级 ToolCatalog: 工具带元数据(category/power/timeout/idempotent), call() 统一做策略(超时门禁/错误语义/追踪/权限), 支持 enable/disable/unregister/热挂载 | src/tools/catalog.js + src/tools/seam.js |
| Skill Catalog + Loader(可枚举可发现) | 新增 skill loader: 扫描 skills/ 目录 SKILL.md, 解析 frontmatter, list/load | src/skills/loader.js |
| Self-modification(agent 改自己运行时) | 新增 selfmod 工具: agent 运行时枚举/启用/禁用能力、加载技能 | src/tools/selfmod.js |

## 不吸收(务实取舍)
- **bundle profile 场景组合** → 皮皮虾已有场景系统, 不重复造
- **完整 Cordis 插件运行时** → 过度设计, 破坏零依赖内核
- **self-modification 的插件注入** → 只做能力级启停, 不做进程级热插拔

## 设计要点
1. **能力缝**: Definition(声明+schema+元数据) / Provider(execute实现) / Consumer(call统一策略入口)。register 时校验元数据。
2. **Consumer 策略**: call() 统一处理 超时门禁(AbortSignal) + 错误语义(TOOL_ERROR_PREFIX) + 追踪(轨迹JSONL) + 禁用门禁。
3. **热挂载**: catalog.unregister(name) / disable(name) / enable(name) / listDetailed() 返回完整元数据, 供 selfmod 工具调用。
4. **Skill loader**: 扫描 skills/*/SKILL.md, 解析 --- frontmatter(name/description), 提供 list()/get(name)/loadAll()。
5. **selfmod 工具**: list_capabilities(枚举工具+技能) / enable_capability / disable_capability / load_skill。让 agent 能运行时调整自己的能力集。

## 测试
新增 test/absorb.deepseek.test.js: 能力缝元数据、Consumer策略(超时/禁用/错误)、热挂载、skill loader枚举、selfmod工具链。跑 node --test 全绿。


---
## 实现结果 (2026-08-14 完成)
- 新增: src/tools/seam.js (能力缝辅助: normalizeMeta/runWithPolicy/toDescriptor/POWER_LEVEL)
- 升级: src/tools/catalog.js (元数据 + 热挂载 unregister/enable/disable + listDetailed)
- 新增: src/skills/loader.js (SkillLoader: 枚举/发现/读取)
- 新增: src/tools/selfmod.js (list_capabilities/enable/disable/load_skill)
- 接入: src/agent/index.js 挂载 registerSelfmodTools
- 优化: power 权限门禁 (ctx.power 明确提供时生效, 向后兼容)
- 测试: test/absorb.deepseek.test.js 9 用例全过; 工具相关回归 25/25 全过
- 零依赖保持, 纯 Node 原生
