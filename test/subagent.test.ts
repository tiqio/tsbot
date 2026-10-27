import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { AgentEngine } from "../src/engine/loop";
import { ScriptedProvider } from "../src/provider/mock";
import type { Registry } from "../src/tools/registry";
import { createRegistry } from "../src/tools/registry";
import { subagentTool } from "../src/tools/subagent";
import { defineTool } from "../src/tools/tool";

const readSchema = z.object({ path: z.string() });

describe("子智能体", () => {
  test("只读工具可用，写工具物理上不存在", async () => {
    const mainRegistry = createRegistry();
    const readOnly = createRegistry();

    readOnly.register(
      defineTool({
        name: "read_file",
        description: "只读",
        schema: readSchema,
        async run({ path }) {
          return `内容:${path}`;
        },
      }),
    );

    // 有意往主注册表里塞一个写工具，验证子智能体拿不到
    mainRegistry.register(
      defineTool({
        name: "write_file",
        description: "写",
        schema: readSchema,
        async run() {
          return "written";
        },
      }),
    );

    const seenTools: string[] = [];
    const observed: Registry = {
      register: () => observed,
      use: () => observed,
      getAvailableTools() {
        const tools = readOnly.getAvailableTools();
        seenTools.push(...tools.map((tool) => tool.name));
        return tools;
      },
      execute: (call, signal) => readOnly.execute(call, signal),
    };

    const provider = new ScriptedProvider([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "s1", name: "read_file", arguments: { path: "nginx.conf" } }],
      },
      { role: "assistant", content: "找到了：root 指向 /var/www" },
    ]);

    const engine = new AgentEngine(provider, mainRegistry, { maxContextChars: 1_000_000 });
    const summary = await engine.runSub("看看 nginx.conf", observed);

    expect(summary).toContain("/var/www");
    expect(seenTools.length).toBeGreaterThan(0);
    expect(seenTools.every((name) => name === "read_file")).toBe(true);
    expect(seenTools).not.toContain("write_file");
  });

  test("超过 10 轮强制召回", async () => {
    const registry = createRegistry();
    registry.register(
      defineTool({
        name: "loop",
        description: "空转",
        schema: z.object({}),
        async run() {
          return "再试一次";
        },
      }),
    );

    const steps = Array.from({ length: 12 }, (_, index) => ({
      role: "assistant" as const,
      content: "",
      toolCalls: [{ id: `c${index}`, name: "loop", arguments: {} }],
    }));

    const engine = new AgentEngine(new ScriptedProvider(steps), registry, {
      maxContextChars: 1_000_000,
    });

    await expect(engine.runSub("无限探索", registry)).rejects.toThrow("强制召回");
  });

  test("subagentTool 把摘要包装成报告返回", async () => {
    const tool = subagentTool(
      {
        async runSub() {
          return "摘要：日志里有 upstream timeout";
        },
      },
      createRegistry(),
    );

    const output = await tool.run({ task_prompt: "查日志" }, {});
    expect(output).toContain("子智能体探索报告");
    expect(output).toContain("upstream timeout");
  });
});
