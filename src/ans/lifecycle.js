// src/ans/lifecycle.js - 生命周期状态机 (ANS)
// 独立可更换模块: agent 只持有 Lifecycle 实例, 需要自定义阶段逻辑时替换此模块即可
// 阶段: born → growing(首次对话) → mature(10 次对话); evolving(进化)/ reproducing(繁衍) 为累计计数
import { info } from "../utils/logger.js";

const MATURE_CHATS = 10;   // 对话达到该次数 → mature
const LOG_LIMIT = 50;      // 阶段日志上限 (环形)

export class Lifecycle {
  constructor() {
    this.stage = "born";
    this.bornAt = Date.now();
    this.chats = 0;
    this.evolved = 0;
    this.reproduced = 0;
    this.log = [];
  }

  // 每次对话推进: born → growing → mature (计数由调用方保证每次对话调一次)
  tick() {
    this.chats += 1;
    if (this.stage === "born") this.to("growing", "首次对话");
    else if (this.stage === "growing" && this.chats >= MATURE_CHATS) this.to("mature", `完成 ${this.chats} 次对话`);
  }

  // 阶段转换 (含日志), 供进化/繁衍等外部事件调用
  to(stage, note) {
    this.stage = stage;
    this.log.push({ stage, note, ts: Date.now() });
    if (this.log.length > LOG_LIMIT) this.log.shift();
    info(`[lifecycle] ${stage}: ${note}`);
  }

  // 人类可读摘要 (可观测)
  status() {
    return {
      stage: this.stage,
      bornAt: new Date(this.bornAt).toISOString(),
      ageMs: Date.now() - this.bornAt,
      chats: this.chats,
      evolved: this.evolved,
      reproduced: this.reproduced,
      recent: this.log.slice(-5),
    };
  }
}
