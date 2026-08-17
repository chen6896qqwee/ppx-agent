// src/channels/index.js - 通道管理器 (注册表, config 驱动, 可更换)
// 每个通道 = Channel 子类 (connect/send/disconnect); 新增通道类型 → 注册进 channelTypes 即可, 不改 manager
// 使用方: new ChannelManager(agent, config.channels) → await start()
import { HttpChannel } from "./http.js";
import { FeishuChannel } from "./feishu.js";
import { WechatWebhookChannel } from "./wechat.js";
import { LogChannel } from "./log.js";

// 内置通道类型注册表: name -> 通道类 (构造函数签名: (agent, configObj))
export const BUILTIN_CHANNEL_TYPES = {
  http: HttpChannel,
  feishu: FeishuChannel,
  wechat: WechatWebhookChannel,
  log: LogChannel,
};

// 启停策略: http 默认开, 其余默认关 (config.channels.<name>.enabled)
function isEnabled(name, cfg) {
  if (name === "http") return cfg.enabled !== false;
  return !!cfg.enabled;
}

export class ChannelManager {
  constructor(agent, config = {}, channelTypes = null) {
    this.agent = agent;
    this.config = config || {};              // config.channels
    this.channelTypes = channelTypes || BUILTIN_CHANNEL_TYPES; // 可注入自定义类型 (更换通道实现)
    this.channels = [];
    this.httpServer = null;
  }

  // 按注册表顺序启动所有启用的通道 (单个失败不影响其他)
  async start() {
    const started = [];
    for (const [name, Ctor] of Object.entries(this.channelTypes)) {
      const cfg = { ...(this.config[name] || {}) };
      if (!isEnabled(name, cfg)) continue;
      try {
        const ch = new Ctor(this.agent, cfg);
        await ch.connect();
        this.channels.push(ch);
        if (ch.server) this.httpServer = ch.server;
        started.push(name);
      } catch (e) {
        console.warn(`[channels] ${name} 通道启动失败: ${e.message}`);
      }
    }
    return started;
  }

  // 按 name 取已启动通道 (无则 null)
  get(name) {
    return this.channels.find((c) => c.name === name) || null;
  }

  // 广播到所有已启动通道 (主动提醒/系统消息投递入口)
  async broadcast(text, { to = "*" } = {}) {
    const out = [];
    for (const c of this.channels) {
      try { out.push(await c.send(to, text)); } catch (e) { console.warn(`[channels] ${c.name} 发送失败: ${e.message}`); }
    }
    return out;
  }

  async stop() {
    for (const c of this.channels) {
      try { await c.disconnect?.(); } catch {}
    }
    this.channels = [];
    this.httpServer = null;
  }
}

export { Channel } from "./base.js";
export { HttpChannel } from "./http.js";
export { FeishuChannel } from "./feishu.js";
export { WechatWebhookChannel } from "./wechat.js";
export { LogChannel } from "./log.js";
