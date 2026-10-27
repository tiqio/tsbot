import { describe, expect, test } from "bun:test";
import { Session } from "../src/context/session";
import { CostTracker, costOf, priceOf } from "../src/observability/tracker";
import { ScriptedProvider } from "../src/provider/mock";

describe("计费", () => {
  test("按百万 token 单价折算", () => {
    // glm-4.5-air: 输入输出都是 0.15 元/1M
    const cost = costOf("glm-4.5-air", { promptTokens: 1_000_000, completionTokens: 0 });
    expect(cost).toBeCloseTo(0.15, 6);
  });

  test("未知模型不收费，但能被识别出来（只统计 token）", () => {
    expect(priceOf("no-such-model")).toBeUndefined();
    expect(priceOf("deepseek-chat")).toBeDefined();
    expect(costOf("no-such-model", { promptTokens: 10_000, completionTokens: 10_000 })).toBe(0);
  });

  test("调用后把用量记进 Session", async () => {
    const session = new Session("billing", "/tmp");
    const inner = new ScriptedProvider([
      {
        role: "assistant",
        content: "ok",
        usage: { promptTokens: 200_000, completionTokens: 100_000 },
      },
    ]);

    const tracker = new CostTracker(inner, "glm-4.5-air", session);
    const response = await tracker.generate([], []);

    expect(response.content).toBe("ok");
    expect(session.totals.promptTokens).toBe(200_000);
    expect(session.totals.completionTokens).toBe(100_000);
    // (200k + 100k) * 0.15 / 1M = 0.045
    expect(session.totals.costCNY).toBeCloseTo(0.045, 6);
  });

  test("模型没返回 usage 时不记账", async () => {
    const session = new Session("billing", "/tmp");
    const inner = new ScriptedProvider([{ role: "assistant", content: "no usage" }]);
    const tracker = new CostTracker(inner, "glm-4.5-air", session);

    await tracker.generate([], []);
    expect(session.totals.costCNY).toBe(0);
  });
});
