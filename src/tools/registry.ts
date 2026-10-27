/**
 * ch05：工具注册表实现。
 *
 * 与原书的差异：execute 变成 async（工具要读文件、起子进程），
 * 所以引擎侧的每一次工具调用都必须 await —— 这是 TS 里"异步传染"的代价，
 * 换来的是不需要为每个工具单独起线程。
 */
import { z } from "zod";
import type { JsonSchema, ToolCall, ToolDefinition, ToolResult } from "../schema/message.ts";
import type { Tool } from "./tool.ts";

export interface MiddlewareDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * 中间件：在执行工具之前拦截。
 * Go 版签名是 func(ctx, call) (bool, string)；这里用对象返回，多一个字段就不用改签名。
 */
export type Middleware = (
  call: ToolCall,
  signal?: AbortSignal,
) => Promise<MiddlewareDecision> | MiddlewareDecision;

export interface Registry {
  /** 当前对模型可见的工具定义 */
  getAvailableTools(): ToolDefinition[];
  /** 挂载一个执行前拦截器（ch16） */
  use(middleware: Middleware): this;
  /** 执行一次工具调用；不允许抛异常，失败也返回 ToolResult(isError=true) */
  execute(call: ToolCall, signal?: AbortSignal): Promise<ToolResult>;
}

/** zod schema → 模型看的 JSON Schema（zod 4 内置） */
export function toDefinition(tool: Tool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.schema, { io: "input" }) as JsonSchema,
  };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export class ToolRegistry implements Registry {
  private readonly tools = new Map<string, Tool>();
  private readonly definitions = new Map<string, ToolDefinition>();
  private readonly middlewares: Middleware[] = [];

  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      console.log(`[Warning] 工具 '${tool.name}' 已经被注册，将被覆盖。`);
    }
    this.tools.set(tool.name, tool);
    this.definitions.set(tool.name, toDefinition(tool));
    console.log(`[Registry] 成功挂载工具: ${tool.name}`);
    return this;
  }

  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  getAvailableTools(): ToolDefinition[] {
    return [...this.definitions.values()];
  }

  async execute(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        toolCallId: call.id,
        output: `Error: 系统中不存在名为 '${call.name}' 的工具。`,
        isError: true,
      };
    }

    // 模型给的参数是不可信输入，先过 zod；校验失败当成工具错误回灌，让模型自己修
    const parsed = tool.schema.safeParse(call.arguments);
    if (!parsed.success) {
      return {
        toolCallId: call.id,
        output: `参数校验失败（${call.name}）：${formatIssues(parsed.error)}\n收到的原始参数：${JSON.stringify(call.arguments).slice(0, 500)}`,
        isError: true,
      };
    }

    // ch16：执行前的拦截链（审批、限流、审计都挂在这里）
    for (const middleware of this.middlewares) {
      const decision = await middleware(call, signal);
      if (!decision.allowed) {
        const reason = decision.reason ?? "未说明原因";
        console.log(`[Registry] ⚠️ 工具 ${call.name} 被 Middleware 拦截: ${reason}`);
        return {
          toolCallId: call.id,
          output: `执行被系统拦截。原因: ${reason}`,
          isError: true, // 必须是 error，才能强制模型阅读拒绝理由
        };
      }
    }

    try {
      const output = await tool.execute(parsed.data, { signal });
      return { toolCallId: call.id, output, isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        toolCallId: call.id,
        output: `Error executing ${call.name}: ${message}`,
        isError: true,
      };
    }
  }
}
