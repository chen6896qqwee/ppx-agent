// src/channels/index.js - 通道管理器
// 统一管理所有通道的 connect/send/disconnect
import { HttpChannel } from "./http.js";
import { FeishuChannel } from "./feishu.js";
import { WechatWebhookChannel } from "./wechat.js";

export class ChannelManager {
  constructor(agent, config = {}) {
    this.agent = agent;
    this.config = config; // config.channels
    this.channels = [];
    this.httpServer = null;
  }

  // 启动所有启用的通道
  async start() {
    const cfg = this.config || {};
    const started = [];

    // HTTP 通道 (默认开, 提供 webhook 挂载点)
    const httpCfg = cfg.http || { enabled: true, port: 8899 };
    if (httpCfg.enabled !== false) {
      const httpCh = new HttpChannel(this.agent, { port: httpCfg.port || 8899 });
      await httpCh.connect();
      this.channels.push(httpCh);
      started.push("http");
      this.httpServer = httpCh.server;
    }

    // 飞书
    if (cfg.feishu?.enabled) {
      try {
        const f = new FeishuChannel(this.agent, cfg.feishu);
        await f.connect();
        this.channels.push(f);
        started.push("feishu");
      } catch (e) {
        console.warn(`[channels] 飞书通道启动失败: ${e.message}`);
      }
    }

    // 微信
    if (cfg.wechat?.enabled) {
      const w = new WechatWebhookChannel(this.agent, cfg.wechat);
      await w.connect();
      this.channels.push(w);
      started.push("wechat");
    }

    return started;
  }

  // 把 webhook 路由挂到 HTTP server (由 server 调用)
  registerWebhookRoutes(/* server */) {
    // 实际挂载逻辑在 server.js 里, 这里保留接口
  }

  async stop() {
    for (const c of this.channels) {
      try { await c.disconnect?.(); } catch {}
    }
    this.channels = [];
  }
}

export { Channel } from "./base.js";
export { HttpChannel } from "./http.js";
export { FeishuChannel } from "./feishu.js";
export { WechatWebhookChannel } from "./wechat.js";