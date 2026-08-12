import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 代理到本地 agent server (8899), 前端只认自己的域名
  async rewrites() {
    return [
      { source: "/message", destination: "http://127.0.0.1:8899/message" },
      { source: "/api/:path*", destination: "http://127.0.0.1:8899/api/:path*" },
    ];
  },
};

export default nextConfig;