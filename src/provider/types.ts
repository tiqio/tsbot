/**
 * ch02：模型适配层的唯一接口。
 *
 * Go 版签名是 Generate(ctx, msgs, tools) (*Message, error)，
 * 这里把 ctx 换成 AbortSignal —— 取消语义在 JS 世界是显式对象，
 * 而不是一个到处透传的隐式上下文。
 */
import type { Message, ToolDefinition } from "../schema/message.ts";

export interface LLMProvider {
  /**
   * @param messages 完整对话历史（含系统提示）
   * @param tools 本轮允许使用的工具；传空数组表示"剥夺工具"
   * @param signal 取消信号
   */
  generate(
    messages: Message[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): Promise<Message>;
}
