/**
 * ch09：把"引擎在想什么"和"人在看什么"解耦。
 *
 * 引擎只管发事件，终端、飞书、Web 各自实现各自的显示方式。
 * 这是整个 Harness 里最便宜、收益最高的一层抽象：
 * 后面接 IM、接 WebSocket、接前端 SSE 都不用改主循环。
 */
export interface Reporter {
  onThinking(): void;
  onToolCall(toolName: string, args: string): void;
  onToolResult(toolName: string, result: string, isError: boolean): void;
  onMessage(content: string): void;
}

/** 什么都不做的实现，用于跑分等"闭嘴"场景 */
export const silentReporter: Reporter = {
  onThinking() {},
  onToolCall() {},
  onToolResult() {},
  onMessage() {},
};
