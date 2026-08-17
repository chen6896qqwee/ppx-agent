import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "皮皮虾 PPX Agent",
  description: "零依赖智能体内核 · 场景/记忆/工具调度",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
