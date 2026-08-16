// 示例: 注入 dense embedding, 把默认 BM25 检索升级为 dense + BM25 RRF 融合
// 用法: 复制到 plugins/ 目录, 把 fetchEmbedding 换成你的真实 embedding 端点
//   cp examples/plugins/embedder.cjs plugins/embedder.cjs
// 注: 默认零依赖纯 BM25; 注入 embedder 后检索自动切 dense 语义检索 (与 BM25 做 RRF 融合)
module.exports = (ctx) => {
  ctx.consume("facts").setEmbedder(async (text) => {
    // TODO: 替换为真实 embedding 调用, 返回归一化向量 number[]
    //   例如: const r = await fetch("http://127.0.0.1:1234/v1/embeddings", {...});
    //         return r.data[0].embedding;
    // 下面是字符 hash 造的 8 维向量 (仅演示 plumbing, 无真实语义)
    const v = new Array(8).fill(0);
    for (const c of String(text)) v[c.charCodeAt(0) % 8] += 1;
    const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  });
};
