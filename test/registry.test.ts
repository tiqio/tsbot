import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { readFileTool } from "../src/tools/read-file";
import { createRegistry, toDefinition } from "../src/tools/registry";
import { defineTool } from "../src/tools/tool";

describe("registry", () => {
  test("zod schema 自动产出 JSON Schema，不需要手写第二份", () => {
    const tool = defineTool({
      name: "demo",
      description: "演示",
      schema: z.object({
        path: z.string().describe("路径"),
        limit: z.number().int().optional(),
      }),
      async run() {
        return "ok";
      },
    });

    const json = toDefinition(tool).inputSchema as {
      type: string;
      properties: Record<string, { type: string }>;
      required: string[];
    };

    expect(json.type).toBe("object");
    expect(json.properties.path?.type).toBe("string");
    expect(json.required).toEqual(["path"]);
  });

  test("未知工具返回 isError 而不是抛异常", async () => {
    const registry = createRegistry();
    const result = await registry.execute({ id: "c1", name: "nope", arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("不存在");
  });

  test("参数不合 schema 时把校验错误回灌给模型", async () => {
    const registry = createRegistry();
    registry.register(
      defineTool({
        name: "echo",
        description: "回声",
        schema: z.object({ text: z.string() }),
        async run({ text }) {
          return text;
        },
      }),
    );

    const bad = await registry.execute({ id: "c1", name: "echo", arguments: { text: 1 } });
    expect(bad.isError).toBe(true);
    expect(bad.output).toContain("参数校验失败");

    const good = await registry.execute({ id: "c2", name: "echo", arguments: { text: "hi" } });
    expect(good.isError).toBe(false);
    expect(good.output).toBe("hi");
  });

  test("read_file 不允许逃出工作区", async () => {
    const tool = readFileTool(process.cwd());
    await expect(tool.run({ path: "../../etc/passwd" }, {})).rejects.toThrow("路径越界");
  });
});
