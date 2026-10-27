import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ReadFileTool } from "../src/tools/read-file.ts";
import { ToolRegistry, toDefinition } from "../src/tools/registry.ts";
import type { Tool } from "../src/tools/tool.ts";

describe("registry", () => {
  test("zod schema 自动产出 JSON Schema，不需要手写第二份", () => {
    const schema = z.object({
      path: z.string().describe("路径"),
      limit: z.number().int().optional(),
    });

    const tool: Tool<typeof schema> = {
      name: "demo",
      description: "演示",
      schema,
      async execute() {
        return "ok";
      },
    };

    const def = toDefinition(tool);
    const json = def.inputSchema as {
      type: string;
      properties: Record<string, { type: string }>;
      required: string[];
    };

    expect(json.type).toBe("object");
    expect(json.properties.path?.type).toBe("string");
    expect(json.required).toEqual(["path"]);
  });

  test("未知工具返回 isError 而不是抛异常", async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute({ id: "c1", name: "nope", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("不存在");
  });

  test("参数不合 schema 时把校验错误回灌给模型", async () => {
    const registry = new ToolRegistry();
    const echoSchema = z.object({ text: z.string() });
    const echo: Tool<typeof echoSchema> = {
      name: "echo",
      description: "回声",
      schema: echoSchema,
      async execute(args) {
        return args.text;
      },
    };
    registry.register(echo);

    const bad = await registry.execute({ id: "c1", name: "echo", arguments: { text: 1 } });
    expect(bad.isError).toBe(true);
    expect(bad.output).toContain("参数校验失败");

    const good = await registry.execute({ id: "c2", name: "echo", arguments: { text: "hi" } });
    expect(good.isError).toBe(false);
    expect(good.output).toBe("hi");
  });

  test("read_file 不允许逃出工作区", async () => {
    const tool = new ReadFileTool(process.cwd());
    await expect(tool.execute({ path: "../../etc/passwd" })).rejects.toThrow("路径越界");
  });
});
