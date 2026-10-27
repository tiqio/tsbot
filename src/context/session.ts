/**
 * ch11：会话与工作记忆。
 *
 * Go 版为了并发安全套了 sync.RWMutex；JS 是单线程事件循环，
 * 只要不把同一个数组跨 await 改坏，就不需要锁——这一层直接消失。
 *
 * 另一个关键点是"孤儿工具结果"：截断历史时如果第一条是 tool_result
 * （role=user 且带 toolCallId），模型会看到没有对应 tool_use 的结果而报错，
 * 所以要从头部剥掉。
 */
import type { Message, Usage } from "../schema/message.ts";

export interface SessionTotals {
  promptTokens: number;
  completionTokens: number;
  costCNY: number;
}

export class Session {
  readonly createdAt = new Date();
  updatedAt = new Date();

  private history: Message[] = [];
  private promptTokens = 0;
  private completionTokens = 0;
  private costCNY = 0;

  constructor(
    readonly id: string,
    readonly workDir: string,
  ) {}

  append(...messages: Message[]): void {
    this.history.push(...messages);
    this.updatedAt = new Date();
  }

  /** 取最近 limit 条，保证第一条不是孤儿 tool_result */
  getWorkingMemory(limit: number): Message[] {
    const total = this.history.length;
    if (limit <= 0 || total <= limit) return [...this.history];

    const tail = this.history.slice(total - limit);

    let start = 0;
    while (start < tail.length) {
      const first = tail[start];
      if (first?.role === "user" && first.toolCallId) start++;
      else break;
    }

    return tail.slice(start);
  }

  /** 会话内部完整历史（调试/落盘用） */
  get all(): readonly Message[] {
    return this.history;
  }

  get length(): number {
    return this.history.length;
  }

  recordUsage(usage: Usage, cost: number): void {
    this.promptTokens += usage.promptTokens;
    this.completionTokens += usage.completionTokens;
    this.costCNY += cost;
    this.updatedAt = new Date();
  }

  get totals(): SessionTotals {
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      costCNY: this.costCNY,
    };
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  getOrCreate(id: string, workDir: string): Session {
    const existing = this.sessions.get(id);
    if (existing) return existing;

    const session = new Session(id, workDir);
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  get size(): number {
    return this.sessions.size;
  }
}

/** 进程级单例：一个进程管一堆会话，按 chatId / sessionId 分开记账 */
export const globalSessionManager = new SessionManager();
