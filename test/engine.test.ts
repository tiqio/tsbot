import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Session } from "../src/context/session.ts";
import { AgentEngine } from "../src/engine/loop.ts";
import { ScriptedProvider } from "../src/provider/mock.ts";
import type { LLMProvider } from "../src/provider/types.ts";
import type { Message } from "../src/schema/message.ts";
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

function newSession(prompt: string): Session {
  const session = new Session("test_session", process.cwd());
  session.append({ role: "user", content: prompt });
  return session;
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

    const engine = new AgentEngine(provider, registry);
    const session = newSession("并行测试");

    const startedAt = Date.now();
    await engine.run(session);
    const elapsed = Date.now() - startedAt;

    // 串行至少 360ms；并发应该接近 120ms
    expect(elapsed).toBeLessThan(300);

    // 三个工具应当在彼此结束前全部启动
    expect(log.slice(0, 3).every((line) => line.startsWith("start:"))).toBe(true);

    // 工具结果按入参顺序写回会话
    const toolResults = session.all.filter((m) => m.toolCallId !== undefined);
    expect(toolResults.map((m) => m.toolCallId)).toEqual(["c1", "c2", "c3"]);
  });

  test("没有工具调用时循环立即结束", async () => {
    const registry = new ToolRegistry();
    const provider = new ScriptedProvider([{ role: "assistant", content: "直接回答" }]);
    const engine = new AgentEngine(provider, registry);

    await expect(engine.run(newSession("你好"))).resolves.toBeUndefined();
  });

  test("工具报错不会中断循环，错误作为观察结果回灌", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "boom",
      description: "永远失败",
      schema: z.object({}),
      async execute(): Promise<string> {
        throw new Error("磁盘满了");
      },
    });

    const provider = new ScriptedProvider([
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "boom", arguments: {} }] },
      { role: "assistant", content: "我看懂报错了" },
    ]);

    const engine = new AgentEngine(provider, registry);
    const session = newSession("触发失败");

    await engine.run(session);

    const observation = session.all.find((m) => m.toolCallId === "c1");
    expect(observation?.content).toContain("磁盘满了");
  });

  test("历史首条是 assistant 时，注入占位 user 消息稳住协议", async () => {
    const registry = new ToolRegistry();
    const calls: Message[][] = [];
    const provider: LLMProvider = {
      async generate(messages) {
        calls.push(messages);
        return { role: "assistant", content: "ok" };
      },
    };

    const engine = new AgentEngine(provider, registry);
    const session = new Session("resume", process.cwd());
    session.append({ role: "assistant", content: "上一轮的回答" });

    await engine.run(session);

    const firstCall = calls[0] ?? [];
    expect(firstCall[0]?.role).toBe("system");
    expect(firstCall[1]?.role).toBe("user");
    expect(firstCall[1]?.content).toContain("系统占位符");
  });
});
