import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mcpToolName, registerMcpTools } from "../src/mcp/bridge";
import { McpClient } from "../src/mcp/client";
import { loadMcpConfig } from "../src/mcp/config";
import { createRegistry } from "../src/tools/registry";

const serverPath = resolve(import.meta.dir, "../src/mcp/server.ts");
const workspace = resolve(import.meta.dir, "../workspace");

async function writeConfig(content: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tsbot-mcp-config-"));
  const file = join(dir, "mcp.json");
  await writeFile(file, JSON.stringify(content), "utf8");
  return file;
}

describe("MCP 配置文件", () => {
  test("解析 servers 表", async () => {
    const file = await writeConfig({
      servers: {
        a: { command: "bun", args: ["x.ts"] },
        b: { command: "node", args: ["y.js"], env: { TOKEN: "1" }, timeoutMs: 5000 },
      },
    });

    const servers = await loadMcpConfig(file);
    expect(servers.map((server) => server.name)).toEqual(["a", "b"]);
    expect(servers[1]?.env?.TOKEN).toBe("1");
    expect(servers[1]?.timeoutMs).toBe(5000);
  });

  test("缺 servers / 缺 command 都给出明确错误", async () => {
    const empty = await writeConfig({});
    await expect(loadMcpConfig(empty)).rejects.toThrow("没有 servers");

    const bad = await writeConfig({ servers: { a: {} } });
    await expect(loadMcpConfig(bad)).rejects.toThrow("缺少 command");
  });

  test("按配置真的能连上并桥接", async () => {
    const file = await writeConfig({
      servers: {
        cfgtest: {
          command: process.execPath,
          args: [serverPath, "--workspace", workspace],
          timeoutMs: 15_000,
        },
      },
    });

    const [config] = await loadMcpConfig(file);
    expect(config).toBeDefined();

    const client = await McpClient.connect(config!);
    try {
      const registry = createRegistry();
      const count = await registerMcpTools(client, registry);
      expect(count).toBe(2);
      expect(registry.getAvailableTools().map((tool) => tool.name)).toContain(
        mcpToolName("cfgtest", "list_files"),
      );
    } finally {
      await client.close();
    }
  });
});
