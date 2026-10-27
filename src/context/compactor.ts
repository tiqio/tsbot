/**
 * ch12：上下文压缩。
 *
 * 长期运行的 Agent 迟早会把上下文撑爆。这里做三件事：
 * 1. 早期工具输出（>200 字符）压成一句话占位符；
 * 2. 近窗口内的工具输出（>1000 字符）掐头留尾；
 * 3. 早期的思考内容（>200 字符）折叠。
 *
 * 与 Go 版差异：Go 用 len(string) 数字节，中文一个字 3 字节；
 * 这里用 JS 的 string.length 数字符（UTF-16 code unit），阈值含义不同但更直观。
 */
import type { Message } from "../schema/message.ts";

const EARLY_OUTPUT_THRESHOLD = 200;
const RECENT_OUTPUT_MAX = 1000;
const HEAD_TAIL = 500;

export class Compactor {
  constructor(
    readonly maxChars = 200_000,
    readonly retainLastMsgs = 6,
  ) {}

  compact(messages: Message[]): Message[] {
    const before = this.estimate(messages);
    if (before < this.maxChars) return messages;

    console.log(
      `[Compactor] ⚠️ 内存告警：当前上下文长度 (${before} 字符) 超过阈值 (${this.maxChars})，触发压缩清理...`,
    );

    const protectFrom = Math.max(0, messages.length - this.retainLastMsgs);

    const compacted = messages.map((message, index): Message => {
      if (message.role === "system") return message;
      const inWindow = index >= protectFrom;

      if (message.role === "user" && message.toolCallId) {
        if (!inWindow) {
          if (message.content.length <= EARLY_OUTPUT_THRESHOLD) return message;
          return {
            ...message,
            content: `...[为了节省内存，早期的工具输出已被系统强制清理。原始长度: ${message.content.length} 字符]...`,
          };
        }
        if (message.content.length <= RECENT_OUTPUT_MAX) return message;
        const head = message.content.slice(0, HEAD_TAIL);
        const tail = message.content.slice(-HEAD_TAIL);
        return {
          ...message,
          content: `${head}\n\n...[内容过长，中间 ${
            message.content.length - HEAD_TAIL * 2
          } 字符已被系统截断]...\n\n${tail}`,
        };
      }

      if (message.role === "assistant" && message.content.length > EARLY_OUTPUT_THRESHOLD) {
        if (inWindow) return message;
        return { ...message, content: "...[早期的推理思考过程已折叠]..." };
      }

      return message;
    });

    const after = this.estimate(compacted);
    console.log(`[Compactor] ✅ 压缩完成。上下文长度从 ${before} 降至 ${after} 字符。`);

    return compacted;
  }

  private estimate(messages: Message[]): number {
    let length = 0;
    for (const message of messages) {
      length += message.content.length;
      for (const call of message.toolCalls ?? []) {
        length += call.name.length + JSON.stringify(call.arguments ?? {}).length;
      }
    }
    return length;
  }
}
