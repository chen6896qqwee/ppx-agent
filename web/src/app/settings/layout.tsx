"use client";
// web/src/app/settings/layout.tsx - 设置页布局 (左侧子导航)
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/model", label: "模型" },
  { href: "/settings/general", label: "通用设置" },
  { href: "/settings/plugins", label: "插件" },
  { href: "/settings/presets", label: "智能体预设" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex h-screen bg-[#0f1115] text-neutral-200">
      <aside className="flex w-56 flex-col border-r border-neutral-800 p-4">
        <Link href="/" className="mb-6 flex items-center gap-2 text-[13px] text-neutral-400 hover:text-neutral-200">
          ← 返回聊天
        </Link>
        <nav className="space-y-1">
          {TABS.map((t) => {
            const active = path === t.href || (t.href === "/settings/model" && path?.startsWith("/settings/model"));
            return (
              <Link key={t.href} href={t.href} className={`block rounded-lg px-3 py-2 text-[13px] transition-colors ${active ? "bg-[#1d2a3a] text-[#4da3ff]" : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"}`}>
                {t.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 text-[11px] text-neutral-500 leading-relaxed">
          设置仅作用于本机 <code className="text-[#4da3ff]">config/ppx.json</code>, 改动即热重载, 无需重启。
        </div>
      </aside>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}