/**
 * ch17：把"派个子智能体去探索"包装成工具。
 *
 * 注意依赖方向：tools 包不认识 engine 包，只认一个 AgentRunner 接口
 * （Go 版用同样的手法避免 import cycle）。reporter 也因此是可选参数。
 */
import { z } from "zod";
import type { Registry } from "./registry.ts";
import type { Tool } from "./tool.ts";

const schema = z.object({
  task_prompt: z
    .string()
    .describe("给子智能体下达的明确探索指令，例如：找出 nginx.conf 里 server 段落的 root 路径"),
});

export interface AgentRunner {
  runSub(taskPrompt: string, registry: Registry, options?: unknown): Promise<string>;
}

export class SubagentTool implements Tool<typeof schema> {
  readonly name = "spawn_subagent";
  readonly description =
    "派出一个专门用于深度探索的子智能体。当你需要阅读大量代码、跨文件查找逻辑时调用它。它探索完毕后返回一份精炼的摘要报告。注意：子智能体只能读，不能写。";
  readonly schema = schema;

  constructor(
    private readonly runner: AgentRunner,
    private readonly readOnlyRegistry: Registry,
  ) {}

  async execute(args: z.infer<typeof schema>): Promise<string> {
    console.log(`[Subagent] 🚀 主 Agent 发起委派: ${args.task_prompt}`);

    const summary = await this.runner.runSub(args.task_prompt, this.readOnlyRegistry);

    console.log("[Subagent] ✅ 子智能体任务结束，报告返回主干。");
    return `【子智能体探索报告】:\n${summary}`;
  }
}
