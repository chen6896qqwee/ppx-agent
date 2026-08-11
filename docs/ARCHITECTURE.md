// 皮皮虾 架构说明 v0.4

## 记忆系统: 腾讯风格四层架构 (v0.4 核心升级)

从 TencentDB-Agent-Memory 偷的 L0-L3 分层, 用零依赖文件实现。

```
L0 原始对话  →  data/memory/l0/YYYY-MM-DD.jsonl
   每日一个文件, 每条消息一行, 过滤噪音/命令/寒暄

L1 原子记忆  →  data/memory/facts.json
   高斯衰减事实库 (score × exp(-λt²)), 命中加分

L2 场景记忆  →  data/memory/l2/scenes.json
   把相关记忆关键词聚类归档成场景 { name, keywords, facts[] }

L3 核心画像  →  data/memory/l3/user.persona.md + agent.persona.md
   从记忆提炼用户画像 + agent 自我画像 (高频词统计)
```

### 数据流
```
对话 → L0记录(JSONL) → 提取事实进L1(facts) → 归档进L2(scene) → 定期提炼L3(画像)
```

### 差异 vs 腾讯原版
| 维度 | 腾讯 MemoryCore | 皮皮虾 |
|------|----------------|--------|
| 依赖 | sqlite-vec+ai-sdk+jieba+zod | 零依赖文件 |
| L1提取 | LLM调用 | 高斯衰减+启发式 |
| L2场景 | Mermaid图 | 关键词聚类 |
| L3画像 | LLM生成 | 高频词统计 |
| 召回 | BM25+向量 | 关键词+衰减分 |

## 全模块地图 (v0.4)

```
src/
├─ agent/index.js     Agent引擎 (编排+工具循环)
├─ memory/
│  ├─ l0.js           L0原始对话          [腾讯式]
│  ├─ fact-store.js   L1原子记忆(高斯衰减)
│  ├─ l2.js           L2场景记忆          [腾讯式]
│  ├─ l3.js           L3核心画像          [腾讯式]
│  ├─ memory-ticker.js 水位移线
│  └─ experience.js   经验库
├─ selfheal/          自愈引擎
├─ tools/             工具系统 (11个)
├─ channels/          通道系统 (http/feishu/wechat)
├─ orchestrator/      军团编排器 (多进程)
├─ llm/               LLM客户端
└─ utils/             基础设施
```

## 测试: 29 全过
- 核心 5 + 工具 7 + 进阶 5 + 通道 3 + 军团 3 + 四层记忆 6