/**
 * ch03：把"思考"和"行动"拆成两个阶段。
 *
 * 关键点：Thinking 阶段把 tools 传成空数组，等于从协议层面剥夺模型调用工具的能力，
 * 逼它先把计划想清楚；Action 阶段再把工具挂回去。
 */
import type { LLMProvider } from "../provider/types.ts";
import type { Registry } from "../tools/registry.ts";
import type { Message } from "../schema/message.ts";

export interface EngineOptions {
  workDir: string;
  /** 慢思考模式：每轮先做一次无工具的推理 */
  enableThinking?: boolean;
}

export class AgentEngine {
  private readonly workDir: string;
  private readonly enableThinking: boolean;

  constructor(
    private readonly provider: LLMProvider,
    private readonly registry: Registry,
    options: EngineOptions,
  ) {
    this.workDir = options.workDir;
    this.enableThinking = options.enableThinking ?? false;
  }

  async run(userPrompt: string, signal?: AbortSignal): Promise<void> {
    console.log(`[Engine] 引擎启动，锁定工作区: ${this.workDir}`);
    console.log(`[Engine] 慢思考模式 (Thinking Phase): ${this.enableThinking}`);

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
      console.log(`\n========== [Turn ${turnCount}] 开始 ==========`);

      const availableTools = this.registry.getAvailableTools();

      // ============ Phase 1: Thinking ============
      if (this.enableThinking) {
        console.log("[Engine][Phase 1] 剥夺工具访问权，强制进入慢思考与规划阶段...");
        const thinkResp = await this.provider.generate(contextHistory, [], signal);
        if (thinkResp.content) {
          console.log(`🧠 [内部思考 Trace]: ${thinkResp.content}`);
          contextHistory.push(thinkResp);
        }
      }

      // ============ Phase 2: Action ============
      console.log("[Engine][Phase 2] 恢复工具挂载，等待模型采取行动...");
      const actionResp = await this.provider.generate(
        contextHistory,
        availableTools,
        signal,
      );
      contextHistory.push(actionResp);

      if (actionResp.content) {
        console.log(`🤖 [对外回复]: ${actionResp.content}`);
      }

      // ============ 执行判断 ============
      const toolCalls = actionResp.toolCalls ?? [];
      if (toolCalls.length === 0) {
        console.log("[Engine] 模型未请求调用工具，任务宣告完成。");
        break;
      }

      console.log(`[Engine] 模型请求调用 ${toolCalls.length} 个工具...`);

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
