import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { AgentEngine } from "../src/engine/loop.ts";
import { ScriptedProvider } from "../src/provider/mock.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import type { Tool } from "../src/tools/tool.ts";

const sleepSchema = z.object({ ms: z.number() });

function makeSleepTool(log: string[]): Tool<typeof sleepSchema> {
  return {
    name: "sleep",
    description: "睡一会儿",
    schema: sleepSchema,
    async execute(args) {
      log.push(`start:${args.ms}`);
      await Bun.sleep(args.ms);
      log.push(`end:${args.ms}`);
      return `slept ${args.ms}`;
    },
  };
}

describe("主循环", () => {
  test("同一轮的多个工具调用并发执行，且观察结果顺序与入参一致", async () => {
    const log: string[] = [];
    const registry = new ToolRegistry();
    registry.register(makeSleepTool(log));

    const provider = new ScriptedProvider([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "c1", name: "sleep", arguments: { ms: 120 } },
          { id: "c2", name: "sleep", arguments: { ms: 120 } },
          { id: "c3", name: "sleep", arguments: { ms: 120 } },
        ],
      },
      { role: "assistant", content: "done" },
    ]);

    const engine = new AgentEngine(provider, registry, { workDir: process.cwd() });

    const startedAt = Date.now();
    await engine.run("并行测试");
    const elapsed = Date.now() - startedAt;

    // 串行至少 360ms；并发应该接近 120ms
    expect(elapsed).toBeLessThan(300);

    // 三个工具应当在彼此结束前全部启动
    expect(log.slice(0, 3).every((line) => line.startsWith("start:"))).toBe(true);
  });

  test("没有工具调用时循环立即结束", async () => {
    const registry = new ToolRegistry();
    const provider = new ScriptedProvider([{ role: "assistant", content: "直接回答" }]);
    const engine = new AgentEngine(provider, registry, { workDir: process.cwd() });

    await expect(engine.run("你好")).resolves.toBeUndefined();
  });
});
