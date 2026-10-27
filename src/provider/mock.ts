/**
 * ch04：脚本化 provider。
 *
 * 原书没有这个东西——它是 TS 版为了"没有 API Key 也能看效果"加的：
 * 按顺序吐出预先写好的 assistant 消息，工具仍然真实执行。
 * ch22 的演示脚本会用它把完整的运维排障流程跑一遍。
 */
import type { LLMProvider } from "./types.ts";
import type { Message } from "../schema/message.ts";

export class ScriptedProvider implements LLMProvider {
  private index = 0;

  constructor(
    private readonly steps: Message[],
    private readonly fallback = "（脚本已播完，任务结束）",
  ) {}

  async generate(): Promise<Message> {
    const step = this.steps[this.index++];
    if (!step) {
      return { role: "assistant", content: this.fallback };
    }
    return step;
  }
}
