// src/channels/wechat.js - 微信通道适配器 (企业微信/公众号 webhook)
// 简化版: 通过 webhook 接收文本并回复 (需配置 token)
// 真实企业微信机器人: 需 app_id/corp_id/secret + 回调 URL
import { Channel } from "./base.js";

export class WechatWebhookChannel extends Channel {
  constructor(agent, { path = "/wechat/webhook", token = "" } = {}) {
    super("wechat", agent);
    this.path = path;
    this.token = token || process.env.WECHAT_WEBHOOK_TOKEN || "";
  }

  async connect() {
    this.connected = true;
    return this;
  }

  // 企业微信回调: { msg_signature, timestamp, nonce, echostr, Encrypt }
  // 简化处理: 假设明文模式 (需在企微后台配置 EncodingAESKey 解密, 此处做框架)
  async handleWebhook(body) {
    const data = typeof body === "string" ? JSON.parse(body) : body;
    // 明文文本消息
    if (data.Content) {
      const text = data.Content;
      const reply = await this.agent.chat(text);
      // 企业微信被动回复 XML
      const toUser = data.FromUserName || "";
      const fromUser = data.ToUserName || "";
      return {
        xml: `<xml>
  <ToUserName><![CDATA[${toUser}]]></ToUserName>
  <FromUserName><![CDATA[${fromUser}]]></FromUserName>
  <CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${reply}]]></Content>
</xml>`,
      };
    }
    // URL 验证
    if (data.echostr) return data.echostr;
    return { error: "未识别的微信消息" };
  }

  async send(to, text) { return text; }
}