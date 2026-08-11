// src/channels/base.js - 通道基类
// 统一通道接口: 每个通道实现 connect/send/disconnect
export class Channel {
  constructor(name, agent) {
    this.name = name;
    this.agent = agent;
    this.connected = false;
  }

  async connect() { throw new Error(`${this.name}: connect() 未实现`); }
  async send(to, text) { throw new Error(`${this.name}: send() 未实现`); }
  async disconnect() { this.connected = false; }

  // 收到消息 → 调 agent 处理 → 回发
  async handleMessage(from, text) {
    const reply = await this.agent.chat(text);
    await this.send(from, reply);
    return reply;
  }
}