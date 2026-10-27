/**
 * ch11：引擎不再持有对话历史 —— 历史属于 Session。
 *
 * 这一改动看着小，但它把"引擎"变成了无状态的纯执行器：
 * 同一进程里可以同时跑很多会话（CLI、飞书群聊、跑分沙箱），
 * 每轮只从自己的 Session 里取最近 20 条工作记忆。
 */
import type { LLMProvider } from "../provider/types.ts";
import type { Registry } from "../tools/registry.ts";
import type { Message } from "../schema/message.ts";
import { PromptComposer } from "../context/composer.ts";
import { Compactor } from "../context/compactor.ts";
import type { Session } from "../context/session.ts";
import type { Reporter } from "./reporter.ts";

export interface EngineOptions {
  /** 慢思考模式：每轮先做一次无工具的推理 */
  enableThinking?: boolean;
  /** 长程任务模式：提示词里强制外部化 PLAN.md / TODO.md */
  planMode?: boolean;
  /** 上下文压缩阈值（字符），默认 200k */
  maxContextChars?: number;
}

export interface RunOptions {
  signal?: AbortSignal;
  reporter?: Reporter;
}

export class AgentEngine {
  private readonly enableThinking: boolean;
  private readonly planMode: boolean;
  private readonly compactor: Compactor;

  constructor(
    private readonly provider: LLMProvider,
    private readonly registry: Registry,
    options: EngineOptions = {},
  ) {
    this.enableThinking = options.enableThinking ?? false;
    this.planMode = options.planMode ?? false;
    this.compactor = new Compactor(options.maxContextChars ?? 200_000, 6);
  }

  async run(session: Session, options: RunOptions = {}): Promise<void> {
    const { signal, reporter } = options;

    console.log(`[Engine] 会话启动: ${session.id}，工作区: ${session.workDir}`);
    console.log(
      `[Engine] Thinking=${this.enableThinking} PlanMode=${this.planMode}`,
    );

    const systemMsg = await new PromptComposer(session.workDir, this.planMode).build();

    let turnCount = 0;

    for (;;) {
      turnCount++;
      console.log(`\n========== [Turn ${turnCount}] 开始 ==========`);

      const availableTools = this.registry.getAvailableTools();

      // ch13：截断后的第一条可能是 assistant（比如刚执行完工具就重启），
      // 协议要求首条非 system 消息必须是 user，这里强行插一条占位符把协议"稳住"。
      const memory = session.getWorkingMemory(20);
      if (memory.length > 0 && memory[0]?.role !== "user") {
        memory.unshift({
          role: "user",
          content:
            "[系统占位符] 这是为了保持上下文连贯性而注入的断点标记。请继续执行你刚才的任务。",
        });
      }

      // ch12：装配好的上下文先过压缩器，再发给模型
      const contextHistory = this.compactor.compact([systemMsg, ...memory]);

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
      session.append(actionResp);

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

      session.append(...observations);
    }
  }
}
