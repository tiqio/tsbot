/**
 * ch11：引擎不再持有对话历史 —— 历史属于 Session。
 *
 * ch17：再加一个 runSub —— 一次性的受限子循环，
 * 只给只读工具、最多 10 轮、结果压缩成一段摘要。
 */
import type { LLMProvider } from "../provider/types.ts";
import type { Registry } from "../tools/registry.ts";
import type { Message } from "../schema/message.ts";
import { PromptComposer } from "../context/composer.ts";
import { Compactor } from "../context/compactor.ts";
import { RecoveryManager } from "../context/recovery.ts";
import type { Session } from "../context/session.ts";
import { ReminderInjector } from "./reminder.ts";
import type { Reporter } from "./reporter.ts";

const SUBAGENT_SYSTEM_PROMPT = `你是一个专门负责深度探索的探路者 (Explorer Subagent)。
你的任务是根据主架构师的指令，在当前工作区内仔细阅读代码、查阅日志，搜集足够的信息。

【核心纪律】
1. 你必须、且只能依靠内置工具（ls / find / grep，或 read_file）去寻找答案，绝对不允许凭空捏造。
2. 如果没有找到确切答案，必须继续使用工具深入搜索。
3. 当且仅当找到确切线索后，停止调用工具，直接输出纯文本汇报。主架构师会根据你的汇报做决策。`;

const MAX_SUB_TURNS = 10;

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
  private readonly recovery = new RecoveryManager();
  private readonly injector = new ReminderInjector();

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
        toolCalls.map(async (toolCall) => {
          reporter?.onToolCall(toolCall.name, JSON.stringify(toolCall.arguments));
          console.log(`  -> 🛠️ 执行工具: ${toolCall.name}`);

          const result = await this.registry.execute(toolCall, signal);

          // ch14：失败时追加"救援指南"，让模型知道下一步该干什么
          const finalOutput = result.isError
            ? this.recovery.analyzeAndInject(toolCall.name, result.output)
            : result.output;

          reporter?.onToolResult(toolCall.name, finalOutput, result.isError);
          console.log(
            result.isError
              ? `  -> ❌ 工具执行报错 [${toolCall.name}]`
              : `  -> ✅ 工具执行成功 [${toolCall.name}] (返回 ${finalOutput.length} 字节)`,
          );

          return {
            call: toolCall,
            result,
            message: {
              role: "user" as const,
              content: finalOutput,
              toolCallId: toolCall.id,
            },
          };
        }),
      );

      session.append(...observations.map((item) => item.message));

      // ch15：拿本轮第一个工具调用做死循环探测（与原书一致）
      const first = observations[0];
      if (first) {
        const reminder = this.injector.checkAndInject(first.call, first.result);
        if (reminder) {
          session.append(reminder);
          reporter?.onMessage(reminder.content);
        }
      }
    }
  }

  /**
   * ch17：子智能体 —— 打完就跑的一次性循环。
   *
   * 三条硬约束：
   * 1. 只拿得到传入的只读注册表，物理上无法写文件；
   * 2. 最多 10 轮，防止它自己卡死；
   * 3. 不落 Session，直接把最后一段文本当摘要返回。
   */
  async runSub(
    taskPrompt: string,
    registry: Registry,
    options: RunOptions = {},
  ): Promise<string> {
    const { signal, reporter } = options;

    const history: Message[] = [
      { role: "system", content: SUBAGENT_SYSTEM_PROMPT },
      { role: "user", content: taskPrompt },
    ];

    for (let turn = 1; turn <= MAX_SUB_TURNS; turn++) {
      const compacted = this.compactor.compact(history);

      // 子任务要快：不传 tools=nil 做慢思考，直接出手
      const actionResp = await this.provider.generate(
        compacted,
        registry.getAvailableTools(),
        signal,
      );
      history.push(actionResp);

      const toolCalls = actionResp.toolCalls ?? [];
      if (toolCalls.length === 0) {
        return actionResp.content;
      }

      const observations = await Promise.all(
        toolCalls.map(async (call): Promise<Message> => {
          reporter?.onToolCall(`[Subagent] ${call.name}`, JSON.stringify(call.arguments));
          const result = await registry.execute(call, signal);
          const output = result.isError
            ? this.recovery.analyzeAndInject(call.name, result.output)
            : result.output;
          reporter?.onToolResult(`[Subagent] ${call.name}`, output, result.isError);

          return { role: "user", content: output, toolCallId: call.id };
        }),
      );

      history.push(...observations);
    }

    throw new Error(
      `子智能体探索过于深入，超过 ${MAX_SUB_TURNS} 轮被强制召回，请给它更明确的指令`,
    );
  }
}
