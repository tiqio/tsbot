import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { AgentEngine } from "../src/engine/loop.ts";
import { ScriptedProvider } from "../src/provider/mock.ts";
import type { Registry } from "../src/tools/registry.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import { SubagentTool } from "../src/tools/subagent.ts";
import type { Tool } from "../src/tools/tool.ts";

const readSchema = z.object({ path: z.string() });
const loopSchema = z.object({});

describe("子智能体", () => {
  test("只读工具可用，写工具物理上不存在", async () => {
    const mainRegistry = new ToolRegistry();
    const readOnly = new ToolRegistry();

    const readTool: Tool<typeof readSchema> = {
      name: "read_file",
      description: "只读",
      schema: readSchema,
      async execute(args) {
        return `内容:${args.path}`;
      },
    };
    readOnly.register(readTool);

    // 有意往主注册表里塞一个写工具，验证子智能体拿不到
    const writeTool: Tool<typeof readSchema> = {
      name: "write_file",
      description: "写",
      schema: readSchema,
      async execute() {
        return "written";
      },
    };
    mainRegistry.register(writeTool);

    const seenTools: string[] = [];
    const observed: Registry = {
      getAvailableTools() {
        const tools = readOnly.getAvailableTools();
        seenTools.push(...tools.map((tool) => tool.name));
        return tools;
      },
      use() {
        return this;
      },
      execute(call, signal) {
        return readOnly.execute(call, signal);
      },
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
    const registry = new ToolRegistry();
    const loopTool: Tool<typeof loopSchema> = {
      name: "loop",
      description: "空转",
      schema: loopSchema,
      async execute() {
        return "再试一次";
      },
    };
    registry.register(loopTool);

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

  test("SubagentTool 把摘要包装成报告返回", async () => {
    const registry = new ToolRegistry();

    const tool = new SubagentTool(
      {
        async runSub() {
          return "摘要：日志里有 upstream timeout";
        },
      },
      registry,
    );

    const output = await tool.execute({ task_prompt: "查日志" });
    expect(output).toContain("子智能体探索报告");
    expect(output).toContain("upstream timeout");
  });
});
