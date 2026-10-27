/**
 * 读取 MCP 服务端清单（JSON），形状照抄 Claude Desktop / Cline 的 mcp.json：
 *
 * {
 *   "servers": {
 *     "fs":   { "command": "cmd", "args": ["/c", "mcp-server-filesystem", "C:/path"] },
 *     "demo": { "command": "bun", "args": ["src/mcp/server.ts", "--workspace", "./workspace"] }
 *   }
 * }
 *
 * 只用 JSON、不加注释，避免为了一点便利引一个 JSON5 依赖。
 */
import { readFile } from "node:fs/promises";
import type { McpServerConfig } from "./types";

export interface McpServerEntry {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface McpConfigFile {
  servers: Record<string, McpServerEntry>;
}

export async function loadMcpConfig(path: string): Promise<McpServerConfig[]> {
  let parsed: Partial<McpConfigFile>;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as Partial<McpConfigFile>;
  } catch (error) {
    throw new Error(
      `读取 MCP 配置失败（${path}）: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const servers = parsed.servers;
  if (!servers || typeof servers !== "object" || Object.keys(servers).length === 0) {
    throw new Error(`MCP 配置里没有 servers: ${path}`);
  }

  return Object.entries(servers).map(([name, entry]) => {
    if (!entry?.command) throw new Error(`MCP 服务端 ${name} 缺少 command`);
    return {
      name,
      command: entry.command,
      args: entry.args,
      cwd: entry.cwd,
      env: entry.env,
      timeoutMs: entry.timeoutMs,
    };
  });
}
