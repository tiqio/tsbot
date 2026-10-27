/**
 * ch04：OpenAI Chat Completions 兼容适配器（智谱 GLM、DeepSeek、vLLM 都能用）。
 *
 * 模型返回的 function.arguments 是一个"JSON 字符串"，天然可能不是合法 JSON。
 * Go 版直接把原始 bytes 往下传；这里显式 try/parse，解析失败就把原文留给
 * 工具的 zod 校验去报错，错误信息对模型更可读。
 */
import type { LLMProvider } from "./types";
import type { JsonSchema, Message, ToolDefinition } from "../schema/message";
import { postJson } from "./http";

export interface OpenAIProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

interface ChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function toToolSchema(schema: JsonSchema): JsonSchema {
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}

export class OpenAIProvider implements LLMProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAIProviderOptions) {
    const base = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.endpoint = `${base}/chat/completions`;
    this.model = options.model ?? "gpt-4o-mini";
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async generate(
    messages: Message[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): Promise<Message> {
    const chatMessages: ChatMessage[] = messages.map((message) => {
      if (message.role === "user" && message.toolCallId) {
        return { role: "tool", content: message.content, tool_call_id: message.toolCallId };
      }
      if (message.role === "assistant") {
        return {
          role: "assistant",
          content: message.content,
          ...(message.toolCalls?.length
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function" as const,
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.arguments ?? {}),
                  },
                })),
              }
            : {}),
        };
      }
      return { role: message.role, content: message.content };
    });

    const body = {
      model: this.model,
      messages: chatMessages,
      ...(tools.length > 0
        ? {
            tools: tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: { type: "object", ...toToolSchema(tool.inputSchema) },
              },
            })),
          }
        : {}),
    };

    const data = await postJson<ChatResponse>(this.endpoint, body, {
      headers: { authorization: `Bearer ${this.options.apiKey}` },
      signal,
      timeoutMs: this.timeoutMs,
    });

    const choice = data.choices?.[0]?.message;
    if (!choice) throw new Error("API 返回了空的 choices");

    const result: Message = {
      role: "assistant",
      content: choice.content ?? "",
    };

    for (const call of choice.tool_calls ?? []) {
      if (call.type !== "function") continue;
      (result.toolCalls ??= []).push({
        id: call.id,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments),
      });
    }

    if (data.usage) {
      result.usage = {
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
      };
    }

    return result;
  }
}
