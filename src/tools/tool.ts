/**
 * ch05：工具的统一形状。
 *
 * 这是 TS 版和 Go 版结构上差别最大的地方：
 * Go 版每个工具要写两份东西——`Definition()` 里的 JSON Schema 手写 map，
 * 和 `Execute()` 里的 args struct。两者没有任何编译期联系，改一个忘一个就漂移。
 * 这里只有一份 zod schema，工具定义、运行时校验、execute 的参数类型都由它派生。
 */
import type { z } from "zod";

export interface ToolContext {
  readonly signal?: AbortSignal;
}

export interface Tool<Args extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly schema: Args;
  execute(args: z.infer<Args>, ctx: ToolContext): Promise<string>;
}
