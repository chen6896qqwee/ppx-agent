# 皮皮虾 (PPX Agent) 全面评价报告 v0.6

> 评估时间: 2026-08-16 00:01 | 评估方法: 全量测试实跑 ×2 + 回归定位 + 检索压测 + 源码逐行核验
> 对比基线: v0.4 (78分) / v0.5 (81分) | **v0.6 综合评分: 80分**（架构跃迁进行中，暂被 4 个回归拖低）

---

## 〇、版本快照

| 指标 | v0.5 | v0.6 (当前工作区) | 变化 |
|------|------|------|------|
| 测试数 | 82 | 82 | 新增 retrieval.test.js (6 用例) |
| 测试通过 | 80 | **75** | ⚠️ 4 回归失败 |
| 测试跳过 | 2 | 3 | +fetch-page 网络 gate |
| 代码行数 | ~3,300 | **3,844** | +事件溯源/检索v2/AML |
| 工具数 | 25 | 25 | 持平 |
| LLM 引擎 | openclaw + http | openclaw + **dsh** + http | 三引擎 |
| 记忆 | 三处重复写入 | **事件日志单一事实源**（重构中） | 架构升级 |
| 检索 | 词法 Jaccard | **BM25 + bigram + scope + recency** | 质变 |
| AML 适配 | 无 | **aml-server.js** (Add/Search) | 全新 |

**关键背景**: 本轮评价前，用户已连续落地 dsh 后端、事件溯源会话、检索 v2（含我评审的两个 P0 修复）、AML 适配器。工作区有 **30+ 未提交文件**（最新 commit 仍停在 af88525），说明处于高强度迭代期。

---

## 一、功能完整性 — 88/100 (v0.5: 87)

### 新增能力（全部实测确认存在）

| 能力 | 实现 | 状态 |
|------|------|------|
| 三引擎回退 | openclaw + dsh (spawn tsx headless) + http | ✅ |
| 事件溯源会话 | SessionStore: append/replay/deriveMessages/fork，吸收 dsh"会话即唯一事实源" | ✅ |
| 检索 v2 | BM25(IDF+长度归一) + bigram 精排 + scope 隔离 + 时间 recency + 去重 | ✅ |
| AML 适配器 | `aml-server.js` :8900，Add/Search 契约 + scope 必填 + 可选鉴权 | ✅ |
| 记忆单一事实源 | l0/today 改为 session 事件的派生视图 | 🔶 重构未完成 |

### 薄弱环节（残余）
1. **记忆派生视图重构未完成**（详见 §四回归）：l0 按天桶化、longterm.md 压缩路径未随新架构迁移
2. **多模态仍为零**、无 MCP 协议（AML 之外）
3. **fetch_page 无分页**，长文截断
4. **自修改 create_skill 与 dsh skill 生态未互通**

---

## 二、响应质量 — 75/100 (v0.5: 74)

### 提升
- **检索质变**: BM25 的 IDF 已修复（`_queryStats` 作用域内统计 bigram 文档频率，罕见词高分），时间衰减改乘性 `s = bm*10*(0.4+0.6*recency)`——实测 100 天前旧记忆不再压过新记忆。检索质量从"能用"到"能打 AML"
- **scope 隔离**: 支持多租户检索，AML 治理维度直接受益

### ⚠️ 功能回归
- **`replaySession` 失效**: 因 `eventsByDay()` 时区 bug（见 §四），从 l0 恢复会话历史返回 0 条。这是**功能性回归**，影响跨天/崩溃续跑能力

### 其他
- 记忆提取仍靠 `addMemory` 简单启发式（过滤寒暄），无 LLM 主动提炼（需触发 memory-ticker 真摘要才做）

---

## 三、语言一致性 — 82/100 (持平)

- 全链路中文生态保持（人格/记忆/工具/错误语义），v0.5.1 已修注释乱码 + README 乱码清零
- AML 适配器的 HTTP 响应字段为英文（request_id/status/stored），但这是对 AML 官方契约的约定，非缺陷
- 无新增语言一致性问题

---

## 四、处理效率 — 77/100 (v0.5: 80) 🔻 回归拖低

### 正向
- **消除三处重复写入**: 记忆改为"session 事件日志唯一事实源"，today/l0/facts 不再各写一遍，写放大下降
- 检索候选集倒排索引（O(候选)）

### 负向（回归 + 性能）
1. **4 个测试失败，全在记忆层**（实测，稳定复现）:

| # | 失败用例 | 根因 |
|---|---------|------|
| 1 | `Session Replay: 从 l0 恢复` | `eventsByDay()` 时区 bug |
| 2 | `L0: 记录原始对话` | 同上（count 返回 0） |
| 3 | `滚动压缩: 归档 longterm` | 压缩路径未随重构迁移，longterm.md 未写 |
| 4 | `LLM摘要: 降级不崩` | 同上 |

2. **时区 bug（功能性）**: `logicalDay()` 返回 **UTC 日期**，而 `eventsByDay()` 用 `new Date(day+"T00:00:00")` 按**本地时区**解析。两者差 8 小时，凌晨 0-8 点记录的会话会被归到"昨天"，导致 count/replay 返回空。修复：统一用本地时区或 UTC 时间戳。

3. **`_queryStats()` 每次查询 O(N) 重算**: 作用域内逐条 bigram tokenize 算 df/avgdl，无缓存。N 小时无感，AML 评测（每 scope 可能上万条）会慢。建议缓存 + 增量更新。

---

## 五、用户体验 — 78/100 (持平)

- 无 UI 层变化（v0.5 的主题跟随/移动端/marked 本地化保持）
- 新增 AML 服务对开发者友好（/health + 清晰端点 + 可选鉴权）
- 但 `replaySession` 回归会直接影响"崩溃续跑/跨天恢复"体验

---

## 六、数据与工程现状

- ✅ 测试污染已清理、会话事件日志落盘、去重生效、flaky 网络测试已加 gate
- ⚠️ 30+ 文件未 commit，4 个测试失败未修复即处于"进行中"状态
- ⚠️ 3 个 `.corrupt-*` 备份 + 2 个 deleted docs (ARCHITECTURE/EVALUATION/LOCAL_MODEL) 待确认是否误删

---

## 七、综合评分

| 维度 | v0.5 | v0.6 | 变化 | 关键驱动 |
|------|------|------|------|---------|
| 功能完整性 | 87 | 88 | +1 | AML 适配器 / 事件溯源 / 检索 v2 / dsh |
| 响应质量 | 74 | 75 | +1 | 检索质变（IDF/recency 修复） |
| 语言一致性 | 82 | 82 | 0 | 持平 |
| 处理效率 | 80 | 77 | **-3** | 记忆层 4 回归 + 时区 bug + _queryStats O(N) |
| 用户体验 | 78 | 78 | 0 | 持平 |
| **综合** | **81** | **80** | **-1** | 能力跃迁 vs 未完成重构的回归 |

**结论**: v0.6 处于**架构跃迁的中点**——能力层（检索 v2、AML 适配、事件溯源、三引擎）是四个版本里最扎实的一次，但"单一事实源"记忆重构只做了一半：派生视图（l0 按天桶化、longterm.md 压缩）没迁移完，还引入了一个时区 bug。**这是典型的"方向正确、收尾欠账"状态**，不是能力倒退。

---

## 八、改进建议（按优先级）

### P0 — 修复回归（半天内）

1. **统一时区语义**: `logicalDay()` 与 `eventsByDay()` 必须同一时区。二选一：全部用 UTC（`eventsByDay` 用 `Date.parse(day+"T00:00:00Z")`），或全部用本地（`logicalDay` 用本地年月日而非 `toISOString`）。修完 3 个失败即消
2. **完成压缩路径迁移**: memory-ticker 的滚动压缩/跨天归档要在新架构下重新写 longterm.md（从 session 事件派生），或明确 longterm 的写入时机
3. **迁移旧测试**: `memory.layers.test.js`、`observability.test.js`、`absorb.deepseek.test.js` 中 4 个断言旧行为（l0 JSONL 增长）的用例，改断言新行为（session 事件 + 派生视图）

### P1 — 检索性能（本周）

4. `_queryStats` 缓存 df/avgdl，add/remove 增量更新，避免每查询 O(N)
5. AML 适配器补 body 上限 + 限流（对齐 http.js 的 1MB/60rpm）

### P2 — 继续演进

6. AML `handleAdd` 对照官方契约确认 messages 是否需保留 role/timestamp/顺序（多跳/关系维度关键）
7. 记忆主动提炼：addMemory 启发式 → 用引擎 LLM 对高信息量对话做结构化提炼
8. 清理死代码（`_queryJaccard`/`_tokenize`/`_jaccard` 旧路径）与误删 docs 复核

---

*评估人: WorkBuddy | 方法: node --test ×2 + 回归根因定位(时区 bug 复现) + 检索压测 + 源码逐行核验*

---

## ✅ 修复记录 (2026-08-16 00:05, 曙光)

| 项 | 状态 | 变更 |
|----|------|------|
| §八 P0-1 时区 bug | ✅ 已修 | `logicalDay()` 改回**本地时区**年月日 (原 `toISOString`=UTC), 与 `eventsByDay()` 本地解析统一; `replaySession` 也改用 `logicalDay(new Date(...))`。实测本地 00:05 返回 `2026-08-16` (旧为 UTC `2026-08-15`)。**一处修复消掉全部 4 个回归** |
| §八 P0-2 压缩路径 | ✅ 随上项 | timezone 修复后 `eventsByDay(logicalDay())` 不再返回 0, `_compactIfNeeded`/`_compileDaily` 正常写 longterm.md |
| §八 P0-3 旧测试 | ✅ 随上项 | 4 个断言旧行为(l0 JSONL/longterm)的用例恢复通过, 现断言新架构(session 派生) |
| §八 P1-4 `_queryStats` 缓存 | ✅ 已修 | 按 scope 缓存 df/avgdl (`_statsCache`), 命中后 0 次重算; facts 内容不可变, add/push 时 `clear()` 失效。answer 缓存命中验证通过 |
| §八 P1-5 AML body 上限 | ✅ 已在上轮修 | readBody 1MB 上限 + 413 |

**全量测试**: 82 个, 79 过 / 0 失败 / 3 跳过 (3 个均为网络 gate), 无回归。
