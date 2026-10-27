/**
 * ch04：Anthropic Messages API 适配器。
 *
 * 与 Go 版最大的差别在 content block 的构造上：
 * Go 用 `ContentBlockParamUnion{OfToolUse: ...}` 这种"结构体伪装联合体"，
 * 必须无条件塞一个空 TextBlock 才能绕开智谱的错误码；
 * TS 的联合类型可以直接按需 append，空块只在真的空时才补。
 */
import type { LLMProvider } from "./types.ts";
import type { JsonSchema, Message, ToolDefinition } from "../schema/message.ts";
import { postJson } from "./http.ts";

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

interface TextBlock {
  type: "text";
  text: string;
}
interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

type RequestBlock = TextBlock | ToolUseBlock | ToolResultBlock;

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

function systemText(messages: Message[]): string {
  return messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
}

function toRequestMessages(messages: Message[]): Array<{ role: "user" | "assistant"; content: RequestBlock[] }> {
  const out: Array<{ role: "user" | "assistant"; content: RequestBlock[] }> = [];

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "user") {
      const block: RequestBlock = message.toolCallId
        ? // 工具输出回灌：必须是 tool_result 块，协议要求与 tool_use 的 id 对齐
          { type: "tool_result", tool_use_id: message.toolCallId, content: message.content }
        : { type: "text", text: message.content };
      out.push({ role: "user", content: [block] });
      continue;
    }

    const blocks: RequestBlock[] = [];
    if (message.content.trim() !== "") blocks.push({ type: "text", text: message.content });
    for (const call of message.toolCalls ?? []) {
      blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
    }
    // 智谱兼容端点要求 assistant 至少有一个块（对应 Go 版注释里的 1214 错误）
    if (blocks.length === 0) blocks.push({ type: "text", text: "" });
    out.push({ role: "assistant", content: blocks });
  }

  return out;
}

function toToolSchema(schema: JsonSchema): JsonSchema {
  // 去掉 zod 产出的元字段，模型侧只认 type/properties/required
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}

function toTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: { type: "object", ...toToolSchema(tool.inputSchema) },
  };
}

export class AnthropicProvider implements LLMProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: AnthropicProviderOptions) {
    const base = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
    this.endpoint = `${base}/v1/messages`;
    this.model = options.model ?? "claude-sonnet-4-5";
    this.maxTokens = options.maxTokens ?? 4096;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async generate(
    messages: Message[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): Promise<Message> {
    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemText(messages),
      messages: toRequestMessages(messages),
      ...(tools.length > 0 ? { tools: tools.map(toTool) } : {}),
    };

    const data = await postJson<AnthropicResponse>(this.endpoint, body, {
      headers: {
        "x-api-key": this.options.apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal,
      timeoutMs: this.timeoutMs,
    });

    const result: Message = { role: "assistant", content: "" };
    for (const block of data.content ?? []) {
      if (block.type === "text") {
        result.content += block.text ?? "";
      } else if (block.type === "tool_use") {
        (result.toolCalls ??= []).push({
          id: block.id ?? "",
          name: block.name ?? "",
          arguments: block.input ?? {},
        });
      }
    }

    if (data.usage) {
      result.usage = {
        promptTokens: data.usage.input_tokens ?? 0,
        completionTokens: data.usage.output_tokens ?? 0,
      };
    }

    return result;
  }
}
