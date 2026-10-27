/**
 * ch09：主循环接入 Reporter。
 *
 * 引擎只负责"发生什么"，怎么展示交给 Reporter：
 * 终端用 ANSI，飞书发卡片，跑分直接静音。
 */
import type { LLMProvider } from "../provider/types.ts";
import type { Registry } from "../tools/registry.ts";
import type { Message } from "../schema/message.ts";
import type { Reporter } from "./reporter.ts";

export interface EngineOptions {
  workDir: string;
  /** 慢思考模式：每轮先做一次无工具的推理 */
  enableThinking?: boolean;
}

export interface RunOptions {
  signal?: AbortSignal;
  reporter?: Reporter;
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

  async run(userPrompt: string, options: RunOptions = {}): Promise<void> {
    const { signal, reporter } = options;

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
        reporter?.onThinking();

        const thinkResp = await this.provider.generate(contextHistory, [], signal);
        if (thinkResp.content) {
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
        reporter?.onMessage(actionResp.content);
      }

      // ============ 执行判断 ============
      const toolCalls = actionResp.toolCalls ?? [];
      if (toolCalls.length === 0) {
        console.log("[Engine] 模型未请求调用工具，任务宣告完成。");
        break;
      }

      console.log(`[Engine] 模型请求调用 ${toolCalls.length} 个工具...`);

      // ch08：并发执行，Promise.all 保持入参顺序
      const observations = await Promise.all(
        toolCalls.map(async (toolCall): Promise<Message> => {
          reporter?.onToolCall(toolCall.name, JSON.stringify(toolCall.arguments));
          console.log(`  -> 🛠️ 执行工具: ${toolCall.name}`);

          const result = await this.registry.execute(toolCall, signal);

          reporter?.onToolResult(toolCall.name, result.output, result.isError);
          console.log(
            result.isError
              ? `  -> ❌ 工具执行报错 [${toolCall.name}]`
              : `  -> ✅ 工具执行成功 [${toolCall.name}] (返回 ${result.output.length} 字节)`,
          );

          return {
            role: "user",
            content: result.output,
            toolCallId: toolCall.id,
          };
        }),
      );

      contextHistory.push(...observations);
    }
  }
}
