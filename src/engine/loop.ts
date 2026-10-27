/**
 * 主循环。
 *
 * 读这个文件应该像读一段流程：run → runTurns → runTurn →（think / act / 执行工具）。
 * 每个函数只做一件事，单屏可读完。
 */
import type { LLMProvider } from "../provider/types";
import type { Registry } from "../tools/registry";
import type { Message, ToolCall, ToolResult } from "../schema/message";
import { PromptComposer } from "../context/composer";
import { Compactor } from "../context/compactor";
import { RecoveryManager } from "../context/recovery";
import type { Session } from "../context/session";
import { Span, exportTrace } from "../observability/trace";
import { ReminderInjector } from "./reminder";
import type { Reporter } from "./reporter";

const SUBAGENT_SYSTEM_PROMPT = `你是一个专门负责深度探索的探路者 (Explorer Subagent)。
你的任务是根据主架构师的指令，在当前工作区内仔细阅读代码、查阅日志，搜集足够的信息。

【核心纪律】
1. 你必须、且只能依靠内置工具（ls / find / grep，或 read_file）去寻找答案，绝对不允许凭空捏造。
2. 如果没有找到确切答案，必须继续使用工具深入搜索。
3. 当且仅当找到确切线索后，停止调用工具，直接输出纯文本汇报。主架构师会根据你的汇报做决策。`;

const MAX_SUB_TURNS = 10;
const WORKING_MEMORY_LIMIT = 20;
const PLACEHOLDER_USER =
  "[系统占位符] 这是为了保持上下文连贯性而注入的断点标记。请继续执行你刚才的任务。";

export interface EngineOptions {
  /** 慢思考模式：每轮先做一次无工具的推理 */
  enableThinking?: boolean;
  /** 长程任务模式：提示词里强制外部化 PLAN.md / TODO.md */
  planMode?: boolean;
  /** 上下文压缩阈值（字符），默认 200k */
  maxContextChars?: number;
  /** 单次 run 允许的最大轮数，默认不限。跑分用它给"跑飞了"封顶 */
  maxTurns?: number;
}

export interface RunOptions {
  signal?: AbortSignal;
  reporter?: Reporter;
}

export class AgentEngine {
  private readonly enableThinking: boolean;
  private readonly planMode: boolean;
  private readonly maxTurns: number;
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
    this.maxTurns = options.maxTurns ?? Number.POSITIVE_INFINITY;
    this.compactor = new Compactor(options.maxContextChars ?? 200_000, 6);
  }

  /** 跑完一个会话，退出时把追踪落盘 */
  async run(session: Session, options: RunOptions = {}): Promise<void> {
    const rootSpan = new Span("Agent.Run")
      .addAttribute("SessionID", session.id)
      .addAttribute("WorkDir", session.workDir)
      .addAttribute("PlanMode", this.planMode);

    try {
      await this.runTurns(session, rootSpan, options);
    } finally {
      rootSpan.end();
      const file = await exportTrace(rootSpan, session.workDir, session.id);
      console.log(`📊 [Tracing] 执行链路已保存至 ${file}`);
    }
  }

  private async runTurns(
    session: Session,
    rootSpan: Span,
    { signal, reporter }: RunOptions,
  ): Promise<void> {
    console.log(`[Engine] 会话启动: ${session.id}，工作区: ${session.workDir}`);
    console.log(`[Engine] Thinking=${this.enableThinking} PlanMode=${this.planMode}`);

    const systemMsg = await new PromptComposer(session.workDir, this.planMode).build();

    for (let turn = 1; ; turn++) {
      if (turn > this.maxTurns) {
        throw new Error(`超过最大轮数 ${this.maxTurns}，强制结束（疑似跑飞）`);
      }

      console.log(`\n========== [Turn ${turn}] 开始 ==========`);
      const turnSpan = new Span(`Turn-${turn}`, rootSpan);

      const finished = await this.runTurn(session, systemMsg, turnSpan, signal, reporter);
      turnSpan.end();

      if (finished) return;
    }
  }

  /** 返回 true 表示模型不再调用工具，任务结束 */
  private async runTurn(
    session: Session,
    systemMsg: Message,
    turnSpan: Span,
    signal: AbortSignal | undefined,
    reporter: Reporter | undefined,
  ): Promise<boolean> {
    const context = this.buildContext(session, systemMsg);
    turnSpan.addAttribute("context_message_count", context.length);

    if (this.enableThinking) {
      await this.think(context, turnSpan, signal, reporter);
    }

    const reply = await this.act(context, turnSpan, signal, reporter);
    session.append(reply);
    if (reply.content) reporter?.onMessage(reply.content);

    const toolCalls = reply.toolCalls ?? [];
    if (toolCalls.length === 0) {
      console.log("[Engine] 模型未请求调用工具，任务宣告完成。");
      return true;
    }

    await this.executeToolCalls(session, toolCalls, turnSpan, signal, reporter);
    return false;
  }

  /** 系统提示 + 最近的工作记忆，必要时补一条占位 user 消息并过压缩器 */
  private buildContext(session: Session, systemMsg: Message): Message[] {
    const memory = session.getWorkingMemory(WORKING_MEMORY_LIMIT);

    // 协议要求首条非 system 消息是 user；截断后可能是 assistant
    if (memory.length > 0 && memory[0]?.role !== "user") {
      memory.unshift({ role: "user", content: PLACEHOLDER_USER });
    }

    return this.compactor.compact([systemMsg, ...memory]);
  }

  /** 第一阶段：剥夺工具，逼模型先想清楚 */
  private async think(
    context: Message[],
    turnSpan: Span,
    signal: AbortSignal | undefined,
    reporter: Reporter | undefined,
  ): Promise<void> {
    console.log("[Engine][Phase 1] 剥夺工具访问权，强制进入慢思考与规划阶段...");
    reporter?.onThinking();

    const span = new Span("LLM.Thinking", turnSpan);
    const response = await this.provider.generate(context, [], signal);
    span.end();

    if (!response.content) return;
    context.push(response);
    turnSpan.addAttribute("thinking", response.content.slice(0, 200));
  }

  /** 第二阶段：挂回工具，拿模型的动作 */
  private async act(
    context: Message[],
    turnSpan: Span,
    signal: AbortSignal | undefined,
    reporter: Reporter | undefined,
  ): Promise<Message> {
    console.log("[Engine][Phase 2] 恢复工具挂载，等待模型采取行动...");

    const span = new Span("LLM.Action", turnSpan).addAttribute(
      "tool_count",
      this.registry.getAvailableTools().length,
    );
    const response = await this.provider.generate(
      context,
      this.registry.getAvailableTools(),
      signal,
    );
    span.end();

    return response;
  }

  /** 同一轮的多个工具并发执行；结果按入参顺序写回会话 */
  private async executeToolCalls(
    session: Session,
    toolCalls: ToolCall[],
    turnSpan: Span,
    signal: AbortSignal | undefined,
    reporter: Reporter | undefined,
  ): Promise<void> {
    console.log(`[Engine] 模型请求调用 ${toolCalls.length} 个工具...`);

    const results = await Promise.all(
      toolCalls.map((call) => this.executeOne(call, turnSpan, signal, reporter)),
    );

    session.append(...results.map((item) => item.message));

    // 拿本轮第一个工具调用做死循环探测
    const first = results[0];
    if (!first) return;

    const reminder = this.injector.checkAndInject(first.call, first.result);
    if (!reminder) return;

    session.append(reminder);
    reporter?.onMessage(reminder.content);
  }

  private async executeOne(
    call: ToolCall,
    turnSpan: Span,
    signal: AbortSignal | undefined,
    reporter: Reporter | undefined,
  ): Promise<{ call: ToolCall; result: ToolResult; message: Message }> {
    const args = JSON.stringify(call.arguments);
    const span = new Span(`Tool.${call.name}`, turnSpan).addAttribute(
      "arguments",
      args.slice(0, 500),
    );

    reporter?.onToolCall(call.name, args);
    console.log(`  -> 🛠️ 执行工具: ${call.name}`);

    const result = await this.registry.execute(call, signal);
    // 失败时追加"救援指南"，让模型知道下一步该干什么
    const output = result.isError
      ? this.recovery.analyzeAndInject(call.name, result.output)
      : result.output;

    span.addAttribute("is_error", result.isError);
    span.addAttribute("output_preview", output.slice(0, 200));
    span.end();

    reporter?.onToolResult(call.name, output, result.isError);
    console.log(
      result.isError
        ? `  -> ❌ 工具执行报错 [${call.name}]`
        : `  -> ✅ 工具执行成功 [${call.name}] (返回 ${output.length} 字节)`,
    );

    return {
      call,
      result,
      message: { role: "user", content: output, toolCallId: call.id },
    };
  }

  /**
   * 子智能体：打完就跑的一次性循环。
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
      const reply = await this.provider.generate(
        this.compactor.compact(history),
        registry.getAvailableTools(),
        signal,
      );
      history.push(reply);

      const toolCalls = reply.toolCalls ?? [];
      if (toolCalls.length === 0) return reply.content;

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
