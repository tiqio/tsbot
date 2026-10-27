/**
 * ch02：消息与工具的公共数据结构。
 *
 * Go 版用 struct + json.RawMessage 表达；TS 里 JSON 本来就是原生类型，
 * 所以 `arguments` 是 unknown，由各工具用 zod 解析（ch05 起）。
 */

export type Role = "system" | "user" | "assistant";

/** 单次模型调用的 token 消耗，ch18 起用于计费 */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface ToolCall {
  id: string;
  name: string;
  /** 模型给出的原始入参，未经校验；schema 由工具自己声明 */
  arguments: unknown;
}

export interface Message {
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  /** 仅 role=user 且作为工具结果回灌时存在 */
  toolCallId?: string;
  usage?: Usage;
}

export interface ToolResult {
  toolCallId: string;
  output: string;
  isError: boolean;
}

/** 交给模型看的 JSON Schema 片段 */
export type JsonSchema = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}
