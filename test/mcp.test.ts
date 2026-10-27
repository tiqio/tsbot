import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { mcpToolName, registerMcpTools } from "../src/mcp/bridge";
import { McpClient } from "../src/mcp/client";
import { createRegistry } from "../src/tools/registry";

const serverPath = resolve(import.meta.dir, "../src/mcp/server.ts");
const workspace = resolve(import.meta.dir, "../workspace");

let client: McpClient;

beforeAll(async () => {
  client = await McpClient.connect({
    name: "test",
    command: process.execPath,
    args: [serverPath, "--workspace", workspace],
    timeoutMs: 15_000,
  });
});

afterAll(async () => {
  await client.close();
});

describe("MCP 客户端", () => {
  test("握手后拿到 serverInfo 与 capabilities", () => {
    expect(client.serverInfo.name).toBe("tsbot-demo-server");
    expect(client.capabilities.tools).toBeDefined();
  });

  test("tools/list 拉到工具，schema 是 JSON Schema", async () => {
    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["list_files", "read_file"]);

    const readFile = tools.find((tool) => tool.name === "read_file");
    expect(readFile?.inputSchema?.type).toBe("object");
  });

  test("tools/call 正常返回文本内容", async () => {
    const result = await client.callTool("read_file", { path: "ports.md" });
    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]?.text).toContain("8082");
  });

  test("工具级失败用 isError 返回，而不是 JSON-RPC 错误", async () => {
    const result = await client.callTool("read_file", { path: "不存在.txt" });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("执行失败");
  });

  test("协议级失败（未知工具）抛异常", async () => {
    await expect(client.callTool("no_such_tool", {})).rejects.toThrow("未知工具");
  });

  test("resources/read 读到工作区文件", async () => {
    const result = await client.readResource("file://ports.md");
    expect(result.contents?.[0]?.text).toContain("api-server");
  });
});

describe("MCP 工具桥接", () => {
  test("桥接后与本地工具同构：定义、校验、执行、错误都走同一条链路", async () => {
    const registry = createRegistry();
    const count = await registerMcpTools(client, registry);
    expect(count).toBe(2);

    const definition = registry
      .getAvailableTools()
      .find((item) => item.name === mcpToolName("test", "read_file"));

    expect(definition?.description.startsWith("[MCP:test]")).toBe(true);
    expect((definition?.inputSchema as { type?: string }).type).toBe("object");

    const ok = await registry.execute({
      id: "c1",
      name: mcpToolName("test", "read_file"),
      arguments: { path: "ports.md" },
    });
    expect(ok.isError).toBe(false);
    expect(ok.output).toContain("8082");

    // JSON Schema 转成 zod 之后，缺参数在本地就被拦住了
    const bad = await registry.execute({
      id: "c2",
      name: mcpToolName("test", "read_file"),
      arguments: {},
    });
    expect(bad.isError).toBe(true);
    expect(bad.output).toContain("参数校验失败");
  });
});
