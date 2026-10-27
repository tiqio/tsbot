/**
 * ch18：成本追踪 —— 用装饰器模式包住 provider。
 *
 * 引擎完全不知道有计费这回事：它拿到的还是一个 LLMProvider。
 * 同一个模式还能继续叠：重试、缓存、限流、审计……
 *
 * 与 Go 版的差异：Go 用 map 查价格，这里用 Record 直接下标；
 * 价格单位是"元 / 百万 token"，只作示例，别拿去做财务。
 */
import type { LLMProvider } from "../provider/types";
import type { Usage } from "../schema/message";

export interface ModelPrice {
  /** 输入价格：元 / 1M tokens */
  input: number;
  /** 输出价格：元 / 1M tokens */
  output: number;
}

/** 价格参考：各单位公开报价（元 / 1M tokens），只作示例，别拿去做财务 */
export const PRICING: Record<string, ModelPrice> = {
  "glm-4.5-air": { input: 0.15, output: 0.15 },
  "glm-4.6": { input: 4, output: 16 },
  "deepseek-chat": { input: 2, output: 8 },
  "deepseek-reasoner": { input: 4, output: 16 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

/**
 * 私有模型/代理商单价可以注入，避免"表里没有就按 0 算"的假账：
 *   TSBOT_PRICING='{"deepseek-flash":{"input":0.5,"output":1.5}}'
 */
const PRICING_OVERRIDE: Record<string, ModelPrice> = (() => {
  try {
    return JSON.parse(process.env.TSBOT_PRICING ?? "{}") as Record<string, ModelPrice>;
  } catch {
    return {};
  }
})();

export function priceOf(model: string): ModelPrice | undefined {
  return PRICING_OVERRIDE[model] ?? PRICING[model];
}

export interface UsageSink {
  recordUsage(usage: Usage, cost: number): void;
  readonly id: string;
  readonly totals: { costCNY: number };
}

export function costOf(model: string, usage: Usage): number {
  const price = priceOf(model);
  if (!price) return 0;
  return (usage.promptTokens * price.input + usage.completionTokens * price.output) / 1_000_000;
}

export class CostTracker implements LLMProvider {
  private warnedMissingPrice = false;

  constructor(
    private readonly next: LLMProvider,
    private readonly model: string,
    private readonly session?: UsageSink,
  ) {}

  async generate(
    messages: Parameters<LLMProvider["generate"]>[0],
    tools: Parameters<LLMProvider["generate"]>[1],
    signal?: AbortSignal,
  ): ReturnType<LLMProvider["generate"]> {
    const startedAt = performance.now();
    const response = await this.next.generate(messages, tools, signal);
    const latencyMs = Math.round(performance.now() - startedAt);

    if (!response.usage) {
      console.log(`[Tracker] ⚠️ 调用完成，但模型没返回 usage | 耗时: ${latencyMs}ms`);
      return response;
    }

    const cost = costOf(this.model, response.usage);
    if (!priceOf(this.model) && !this.warnedMissingPrice) {
      this.warnedMissingPrice = true;
      console.log(
        `[Tracker] ⚠️ 没有 ${this.model} 的单价，本次只统计 token。要算钱就用 TSBOT_PRICING 注入。`,
      );
    }
    console.log(
      `[Tracker] 📊 调用完成 | 耗时: ${latencyMs}ms | 输入: ${response.usage.promptTokens} tk | 输出: ${response.usage.completionTokens} tk | 花费: ¥${cost.toFixed(6)}`,
    );

    if (this.session) {
      this.session.recordUsage(response.usage, cost);
      console.log(
        `[Tracker] 💰 会话 ${this.session.id} 累计: ¥${this.session.totals.costCNY.toFixed(6)}`,
      );
    }

    return response;
  }
}
