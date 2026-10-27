/**
 * 把"派个子智能体去探索"包装成工具。
 *
 * 依赖方向：tools 不认识 engine，只认一个 AgentRunner 接口
 * （Go 版用同样手法避免 import cycle）。
 */
import { z } from "zod";
import type { Registry } from "./registry";
import { defineTool } from "./tool";

export interface AgentRunner {
  runSub(taskPrompt: string, registry: Registry, options?: unknown): Promise<string>;
}

export const subagentTool = (runner: AgentRunner, readOnlyRegistry: Registry) =>
  defineTool({
    name: "spawn_subagent",
    description:
      "派出一个专门用于深度探索的子智能体。当你需要阅读大量代码、跨文件查找逻辑时调用它。它探索完毕后返回一份精炼的摘要报告。注意：子智能体只能读，不能写。",
    schema: z.object({
      task_prompt: z
        .string()
        .describe(
          "给子智能体下达的明确探索指令，例如：找出 nginx.conf 里 server 段落的 root 路径",
        ),
    }),
    async run({ task_prompt }) {
      console.log(`[Subagent] 🚀 主 Agent 发起委派: ${task_prompt}`);
      const summary = await runner.runSub(task_prompt, readOnlyRegistry);
      console.log("[Subagent] ✅ 子智能体任务结束，报告返回主干。");
      return `【子智能体探索报告】:\n${summary}`;
    },
  });
