/**
 * ch02：工具注册表接口。
 *
 * ch02 只有契约，具体实现（Map + Middleware 链）在 ch05 / ch16 逐步补齐。
 */
import type { ToolCall, ToolDefinition, ToolResult } from "../schema/message.ts";

export interface Registry {
  /** 当前对模型可见的工具定义 */
  getAvailableTools(): ToolDefinition[];
  /** 执行一次工具调用；不允许抛异常，失败也返回 ToolResult(isError=true) */
  execute(call: ToolCall, signal?: AbortSignal): Promise<ToolResult>;
}
