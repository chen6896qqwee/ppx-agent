"use client";
// web/src/app/settings/plugins/page.tsx - 插件与能力状态
// 展示工具启用状态 / 方法技能 / MCP 连接状态 (数据来自 /api/stats)
import { useEffect, useState } from "react";
import Link from "next/link";
import { getApiBase, getAuthToken } from "../../../lib/api";

type ToolInfo = { name: string; enabled: boolean; category?: string };
type SkillInfo = { id: string; description?: string };
type Stats = {
  tools?: { total: number; enabled: number; list?: ToolInfo[] };
  skills?: SkillInfo[];
  mcp?: { connected: boolean; count: number };
};

async function fetchStats(): Promise<Stats> {
  const base = getApiBase();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = getAuthToken();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const r = await fetch(base + "/api/stats", { headers });
  const text = await r.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const msg = (data && typeof data === "object" && "error" in data) ? String((data as { error: unknown }).error) : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return (data || {}) as Stats;
}

export default function PluginsSettingsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      setStats(await fetchStats());
      setErr(null);
    } catch (e: unknown) {
      setErr((e as Error).message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const tools = stats?.tools;
  const toolList = tools?.list || [];
  const skills = stats?.skills || [];
  const mcp = stats?.mcp;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#0f1115] p-8 text-neutral-200">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/" className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[12px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200">← 返回聊天</Link>
          <h1 className="text-lg font-semibold">插件与能力</h1>
        </div>
        <p className="mb-6 text-[13px] text-neutral-500">当前内核加载的工具、方法技能与外部 MCP 连接状态。数据来自运行时统计。</p>

        {err && <div className="mb-4 rounded-xl border border-red-900/40 bg-red-950/30 px-4 py-3 text-[13px] text-red-300">⚠️ {err}（请确认后端已启动）</div>}

        {loading ? (
          <div className="py-8 text-center text-[13px] text-neutral-600">加载中…</div>
        ) : (
          <div className="space-y-6">
            {/* 工具 */}
            <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold">内置工具</h2>
                <span className="rounded-full bg-neutral-800 px-2.5 py-0.5 text-[11px] text-neutral-400">{tools?.enabled ?? 0} / {tools?.total ?? 0} 启用</span>
              </div>
              {toolList.length === 0 ? (
                <p className="text-[12px] text-neutral-600">无工具数据 (工具未启用或后端未返回明细)。</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {toolList.map((t) => (
                    <div key={t.name} className="flex items-center gap-2 rounded-lg bg-neutral-950/50 px-3 py-2">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.enabled ? "bg-[#3ddc84]" : "bg-[#ff6b6b]"}`}></span>
                      <span className="truncate text-[12px] text-neutral-300">{t.name}</span>
                      {t.category && <span className="ml-auto shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">{t.category}</span>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 方法技能 */}
            <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold">方法技能</h2>
                <span className="rounded-full bg-neutral-800 px-2.5 py-0.5 text-[11px] text-neutral-400">{skills.length} 个</span>
              </div>
              {skills.length === 0 ? (
                <p className="text-[12px] text-neutral-600">无方法技能 (skills/ 目录为空或未加载)。</p>
              ) : (
                <div className="space-y-1.5">
                  {skills.map((s) => (
                    <div key={s.id} className="flex items-start gap-2 rounded-lg bg-neutral-950/50 px-3 py-2">
                      <span className="mt-0.5 shrink-0 text-[12px] font-medium text-[#4da3ff]">{s.id}</span>
                      <span className="text-[12px] text-neutral-400">{s.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* MCP */}
            <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold">MCP 连接</h2>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${mcp?.connected ? "bg-[#0f3d24] text-[#3ddc84]" : "bg-neutral-800 text-neutral-500"}`}>
                  {mcp?.connected ? `已连接 · ${mcp.count ?? 0} 工具` : "未连接"}
                </span>
              </div>
              <p className="text-[12px] text-neutral-600">
                {mcp?.connected
                  ? `已注册 ${mcp.count ?? 0} 个 MCP 工具, 与内置工具共用工具目录, agent 可直接调用。`
                  : "未配置或未连接 MCP 服务器。在 config/ppx.json 的 mcp.servers 配置 stdio/http 服务器后, 启动时自动连接。"}
              </p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
