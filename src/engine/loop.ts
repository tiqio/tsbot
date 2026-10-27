/**
 * ch02：最小 ReAct 循环。
 *
 * 这一版刻意保持"笨"：串行执行工具、没有任何上下文压缩，
 * 目的是先把 模型 → 工具 → 观察结果 的闭环跑通。
 */
import type { LLMProvider } from "../provider/types.ts";
import type { Registry } from "../tools/registry.ts";
import type { Message } from "../schema/message.ts";

export class AgentEngine {
  constructor(
    private readonly provider: LLMProvider,
    private readonly registry: Registry,
    private readonly workDir: string,
  ) {}

  async run(userPrompt: string, signal?: AbortSignal): Promise<void> {
    console.log(`[Engine] 引擎启动，锁定工作区: ${this.workDir}`);

    const contextHistory: Message[] = [
      {
        role: "system",
        content:
          "You are tsbot, an expert coding assistant. You have full access to tools in the workspace.",
      },
      { role: "user", content: userPrompt },
    ];

    let turnCount = 0;

    for (;;) {
      turnCount++;
      console.log(`========== [Turn ${turnCount}] 开始 ==========`);

      const availableTools = this.registry.getAvailableTools();

      console.log("[Engine] 正在思考 (Reasoning)...");
      const response = await this.provider.generate(
        contextHistory,
        availableTools,
        signal,
      );
      contextHistory.push(response);

      if (response.content) {
        console.log(`🤖 模型: ${response.content}`);
      }

      const toolCalls = response.toolCalls ?? [];
      if (toolCalls.length === 0) {
        console.log("[Engine] 任务完成，退出循环。");
        break;
      }

      console.log(`[Engine] 模型请求调用 ${toolCalls.length} 个工具...`);

      // ch02 先串行；并发版在 ch08
      for (const toolCall of toolCalls) {
        console.log(
          `  -> 🛠️ 执行工具: ${toolCall.name}, 参数: ${JSON.stringify(toolCall.arguments)}`,
        );

        const result = await this.registry.execute(toolCall, signal);

        if (result.isError) {
          console.log(`  -> ❌ 工具执行报错: ${result.output}`);
        } else {
          console.log(`  -> ✅ 工具执行成功 (返回 ${result.output.length} 字节)`);
        }

        contextHistory.push({
          role: "user",
          content: result.output,
          toolCallId: toolCall.id,
        });
      }
    }
  }
}
