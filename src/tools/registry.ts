/**
 * 工具注册表。
 *
 * 对外只暴露一个 `Registry` 类型和一个 `createRegistry()` 工厂，实现类不导出 ——
 * 避免 Go 式"interface + struct 两个名字指一件事"的读法成本。
 */
import { z } from "zod";
import type { JsonSchema, ToolCall, ToolDefinition, ToolResult } from "../schema/message";
import type { Tool } from "./tool";

export interface MiddlewareDecision {
  allowed: boolean;
  reason?: string;
}

/** 执行前拦截器：审批、限流、审计都挂在这里 */
export type Middleware = (
  call: ToolCall,
  signal?: AbortSignal,
) => Promise<MiddlewareDecision> | MiddlewareDecision;

export interface Registry {
  register(tool: Tool): Registry;
  use(middleware: Middleware): Registry;
  /** 当前对模型可见的工具定义 */
  getAvailableTools(): ToolDefinition[];
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

class RegistryImpl implements Registry {
  private readonly tools = new Map<string, Tool>();
  private readonly definitions = new Map<string, ToolDefinition>();
  private readonly middlewares: Middleware[] = [];

  register(tool: Tool): Registry {
    if (this.tools.has(tool.name)) {
      console.log(`[Warning] 工具 '${tool.name}' 已经被注册，将被覆盖。`);
    }
    this.tools.set(tool.name, tool);
    this.definitions.set(tool.name, toDefinition(tool));
    console.log(`[Registry] 成功挂载工具: ${tool.name}`);
    return this;
  }

  use(middleware: Middleware): Registry {
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

    // 模型给的参数是不可信输入，先过 zod；失败当成工具错误回灌，让模型自己修
    const parsed = tool.schema.safeParse(call.arguments);
    if (!parsed.success) {
      return {
        toolCallId: call.id,
        output: `参数校验失败（${call.name}）：${formatIssues(parsed.error)}\n收到的原始参数：${JSON.stringify(call.arguments).slice(0, 500)}`,
        isError: true,
      };
    }

    for (const middleware of this.middlewares) {
      const decision = await middleware(call, signal);
      if (decision.allowed) continue;

      const reason = decision.reason ?? "未说明原因";
      console.log(`[Registry] ⚠️ 工具 ${call.name} 被 Middleware 拦截: ${reason}`);
      return {
        toolCallId: call.id,
        output: `执行被系统拦截。原因: ${reason}`,
        isError: true, // 必须是 error，才能强制模型阅读拒绝理由
      };
    }

    try {
      const output = await tool.run(parsed.data, { signal });
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

export function createRegistry(): Registry {
  return new RegistryImpl();
}
