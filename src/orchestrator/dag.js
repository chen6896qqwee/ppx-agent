// src/orchestrator/dag.js - DAG 任务编排 (军团从 broadcast/dispatch 升级为任务图)
// 纯函数零依赖: topoLevels 拓扑分层 + runDag 分层并行执行 + 依赖结果数据流
// graph.nodes = [{ id, task, dependsOn?: [id], agent?: name }]

// 拓扑分层 (Kahn 算法): 返回 [ [同层可并行的节点id], ... ], 检测环
export function topoLevels(nodes) {
  const ids = new Set(nodes.map((n) => n.id));
  const indeg = new Map();
  const children = new Map();
  for (const n of nodes) {
    const deps = (n.dependsOn || []).filter((d) => ids.has(d));
    indeg.set(n.id, deps.length);
    for (const d of deps) {
      if (!children.has(d)) children.set(d, []);
      children.get(d).push(n.id);
    }
  }
  const levels = [];
  let frontier = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const seen = new Set();
  while (frontier.length) {
    levels.push(frontier);
    const next = [];
    for (const id of frontier) {
      seen.add(id);
      for (const c of children.get(id) || []) {
        indeg.set(c, indeg.get(c) - 1);
        if (indeg.get(c) === 0) next.push(c);
      }
    }
    frontier = next;
  }
  if (seen.size < nodes.length) {
    const cyclic = [...ids].filter((id) => !seen.has(id)).join(",");
    throw new Error("DAG 存在环, 无法编排: " + cyclic);
  }
  return levels;
}

// 执行 DAG: 每层节点并行, 上游结果作为 deps 传给下游 executor。
// executor(id, node, deps) => Promise<result>, deps = { 依赖id: 结果 }
export async function runDag(graph, executor) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const levels = topoLevels(graph.nodes);
  const results = {};
  const order = [];
  for (const level of levels) {
    await Promise.all(level.map(async (id) => {
      const node = byId.get(id);
      const deps = {};
      for (const d of node.dependsOn || []) deps[d] = results[d];
      results[id] = await executor(id, node, deps);
      order.push(id);
    }));
  }
  return { results, order };
}
