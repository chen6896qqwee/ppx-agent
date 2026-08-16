"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { listProviders, type Provider } from "../lib/api";

type Msg = { role: "user" | "agent"; content: string };
type Scene = { id: string; name: string; mode: string; description: string; canHelp: string; facts: number; lastUpdated: string };
type Trace = { tool: string; ok: boolean; durationMs: number; args: string };
type Fact = { content: string; score: number; type: string };

export default function Home() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"scenes" | "memory" | "traces" | "stats">("scenes");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [snum, setSnum] = useState(-1);
  const [providers, setProviders] = useState<Provider[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView(); }, [msgs]);

  // 首启检测: 没有任何就绪提供方时显示顶部引导条 (仅一次, 配好后自动消失)
  useEffect(() => {
    listProviders().then((r) => setProviders(r.providers)).catch(() => {});
  }, []);
  const hasReady = providers.some((p) => p.api_key_set || p.mjs || p.dsh_root);

  async function send() {
    const t = input.trim(); if (!t || busy) return;
    setMsgs((m) => [...m, { role: "user", content: t }]);
    setInput(""); setBusy(true);
    try {
      const r = await fetch("/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: t }) });
      const j = await r.json();
      setMsgs((m) => [...m, { role: "agent", content: j.reply || j.error || "(无回复)" }]);
    } catch (e: any) { setMsgs((m) => [...m, { role: "agent", content: "请求失败: " + e.message }]); }
    setBusy(false);
  }

  async function loadScene() {
    const r = await fetch("/api/memory"); const j = await r.json();
    setScenes(j.scenes || []); setFacts(j.facts || []);
  }
  async function loadTraces() {
    const r = await fetch("/api/traces?limit=50"); setTraces(await r.json());
  }
  async function loadStats() {
    const r = await fetch("/api/stats"); setStats(await r.json());
  }
  useEffect(() => { loadScene(); }, []);
  useEffect(() => { if (tab === "traces") loadTraces(); if (tab === "stats") loadStats(); }, [tab, snum]);

  async function newScene() {
    const n = prompt("场景名称 (如: A股交易助手)");
    const d = prompt("场景介绍 (这个场景是干嘛的)");
    const h = prompt("能帮用户干什么 (能力清单)");
    if (n && d && h) {
      await fetch("/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: `用 scene_create 创建场景: 名称=${n}, 介绍=${d}, 能帮=${h}` }) });
      loadScene();
    }
  }

  return (
    <div className="flex h-screen bg-[#0f1115] text-neutral-200">
      {/* 聊天区 */}
      <main className="flex flex-1 flex-col border-r border-neutral-800">
        <header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#28b894] to-[#3b82f6] text-lg font-bold text-white">皮</div>
          <div>
            <h1 className="text-sm font-semibold">皮皮虾</h1>
            <p className="text-[11px] text-neutral-500">PPX Agent · 零依赖智能体内核</p>
          </div>
          <Link href="/settings/model" className="ml-auto rounded-lg border border-neutral-700 px-3 py-1.5 text-[12px] text-neutral-300 hover:bg-neutral-800 hover:text-neutral-200">设置</Link>
          <span className="rounded-full bg-[#1d2a3a] px-2.5 py-0.5 text-[11px] text-[#4da3ff]">在线</span>
        </header>
        {!hasReady && (
          <div className="flex items-center gap-3 border-b border-[#5e2b2b] bg-[#2b1616] px-5 py-3 text-[12px] text-[#ffb4b4]">
            <span>⚠️</span>
            <span className="flex-1">还没有配置任何模型, 皮皮虾现在无法对话。先去设置 → 模型 连一个模型吧。</span>
            <Link href="/settings/model" className="rounded-lg bg-[#ff6b6b] px-3 py-1 text-[11px] font-medium text-white hover:bg-[#e25555]">前往配置</Link>
            <button onClick={() => setProviders([{ id: "_dismiss", api_key_set: true } as Provider])} className="text-[11px] text-neutral-500 hover:text-neutral-300" title="稍后再说">✕</button>
          </div>
        )}
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {msgs.length === 0 && <p className="mt-10 text-center text-sm text-neutral-600">和皮皮虾聊聊吧</p>}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-[#1d5cff] text-white" : "bg-neutral-800 border border-neutral-700"}`}>{m.content}</div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <footer className="flex gap-2 border-t border-neutral-800 p-4">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="输入消息，Enter 发送" className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm outline-none focus:border-[#1d5cff]" />
          <button onClick={send} disabled={busy} className="rounded-xl bg-[#1d5cff] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy ? "…" : "发送"}</button>
        </footer>
      </main>

      {/* 右侧面板 */}
      <aside className="flex w-[380px] flex-col">
        <div className="flex border-b border-neutral-800 text-[13px]">
          {(["scenes","memory","traces","stats"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 py-3 transition-colors ${tab === t ? "border-b-2 border-[#4da3ff] text-[#4da3ff]" : "text-neutral-500 hover:text-neutral-300"}`}>{t === "scenes" ? "场景" : t === "memory" ? "记忆" : t === "traces" ? "轨迹" : "统计"}</button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "scenes" && (
            <div>
              <button onClick={newScene} className="mb-3 w-full rounded-xl bg-[#1d5cff] py-2.5 text-sm font-medium text-white hover:bg-[#1a4fd8]">+ 新建场景</button>
              {scenes.map((s) => (
                <div key={s.id} className="mb-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{s.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${s.mode === "manual" ? "bg-[#0f3d24] text-[#3ddc84]" : "bg-neutral-800 text-neutral-500"}`}>{s.mode === "manual" ? "自定义" : "自动"}</span>
                  </div>
                  {s.description && <p className="mt-2 text-[13px] text-neutral-300">{s.description}</p>}
                  {s.canHelp && <p className="mt-1 text-[13px] text-[#4da3ff]">能帮: {s.canHelp}</p>}
                  <p className="mt-2 text-[11px] text-neutral-600">{s.facts} 条记忆 · 更新 {s.lastUpdated}</p>
                </div>
              ))}
              {scenes.length === 0 && <p className="text-center text-sm text-neutral-600">暂无场景</p>}
            </div>
          )}
          {tab === "memory" && (
            <div>
              {facts.map((f, i) => <div key={i} className="mb-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-[13px]">{f.content}</div>)}
              {facts.length === 0 && <p className="text-center text-sm text-neutral-600">暂无记忆</p>}
            </div>
          )}
          {tab === "traces" && (
            <div>
              {traces.map((t, i) => (
                <div key={i} className="mb-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                  <div className="flex items-center gap-2 text-[13px]"><span className="font-medium">{t.tool}</span><span className={`rounded px-1.5 text-[10px] ${t.ok ? "bg-[#0f3d24] text-[#3ddc84]" : "bg-[#3d1d1d] text-[#ff6b6b]"}`}>{t.ok ? "OK" : "FAIL"}</span><span className="text-neutral-500">{t.durationMs}ms</span></div>
                  <p className="mt-1 truncate text-[11px] text-neutral-600">{t.args}</p>
                </div>
              ))}
              {traces.length === 0 && <p className="text-center text-sm text-neutral-600">暂无轨迹</p>}
            </div>
          )}
          {tab === "stats" && stats && (
            <div>
              <div className="mb-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3.5 text-[13px]">
                调用 {stats.count} 次 · 失败 {stats.failed} · 失败率 <span className={Number(stats.failRate) > 10 ? "text-[#ff6b6b]" : "text-[#3ddc84]"}>{stats.failRate}</span>
              </div>
              <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3.5">
                <p className="mb-2 text-[12px] text-neutral-500">慢工具 Top</p>
                {(stats.slowTools || []).map((s: any, i: number) => <div key={i} className="flex justify-between border-b border-neutral-800 py-1.5 text-[13px] last:border-0"><span>{s.tool}</span><span className="text-[#4da3ff]">{s.avgMs}ms</span></div>)}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}