/**
 * 工具的唯一形状：一份 zod schema + 一个 run。
 *
 * 整个仓库只有这一处出现泛型；工具文件只写 name / description / schema / run
 * 四个字段，读者不需要解码 `Tool<typeof schema>` 或 `z.infer`。
 *
 * 这也是主流 TS Agent 项目（Claude Code / OpenCode 一类）的真实风格：
 * 对象字面量 + 一个 helper，而不是类层次。
 */
import type { z } from "zod";

export interface ToolContext {
  readonly signal?: AbortSignal;
}

export interface Tool<Args extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly schema: Args;
  /** 参数已由注册表用 schema 校验过，这里拿到的是收窄后的类型 */
  run(args: z.infer<Args>, ctx: ToolContext): Promise<string>;
}

export function defineTool<Args extends z.ZodType>(tool: Tool<Args>): Tool<Args> {
  return tool;
}
