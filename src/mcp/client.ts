/**
 * MCP 客户端：拉起一个服务端进程，走 stdio 上的 JSON-RPC。
 *
 * 生命周期严格按规范来：
 *   spawn → initialize → notifications/initialized → tools/list … → 关闭
 * 不做 HTTP/SSE 传输（那份协议更啰嗦，且对这个 harness 没有增量收益）。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { JsonRpcConnection } from "./connection";
import {
  PROTOCOL_VERSION,
  type McpCallToolResult,
  type McpCapabilities,
  type McpInitializeResult,
  type McpReadResourceResult,
  type McpResourceDescriptor,
  type McpServerConfig,
  type McpServerInfo,
  type McpToolDescriptor,
} from "./types";

export class McpClient {
  private constructor(
    readonly name: string,
    private readonly child: ChildProcess,
    private readonly connection: JsonRpcConnection,
    private readonly info: McpServerInfo,
    private readonly caps: McpCapabilities,
  ) {}

  /** 拉起进程并完成握手；失败时会把子进程杀掉，不留孤儿 */
  static async connect(config: McpServerConfig): Promise<McpClient> {
    const child = spawn(config.command, config.args ?? [], {
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const stderr = createInterface({ input: child.stderr! });
    stderr.on("line", (line) => console.log(`[mcp:${config.name}] ${line}`));

    const connection = new JsonRpcConnection(child.stdout!, child.stdin!, {
      timeoutMs: config.timeoutMs,
      onNotification: (method) => console.log(`[mcp:${config.name}] 通知: ${method}`),
      onClose: (error) => console.log(`[mcp:${config.name}] 连接关闭: ${error?.message ?? "正常"}`),
    });

    try {
      const init = await connection.request<McpInitializeResult>("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "tsbot", version: "0.1.0" },
      });

      // 规范要求握手后立刻发这条通知，否则部分服务端不肯接后面的请求
      connection.notify("notifications/initialized");

      if (init.protocolVersion !== PROTOCOL_VERSION) {
        console.log(
          `[mcp:${config.name}] ⚠️ 协议版本不一致：客户端 ${PROTOCOL_VERSION}，服务端 ${init.protocolVersion}`,
        );
      }

      console.log(
        `[mcp:${config.name}] ✅ 已连接 ${init.serverInfo.name}@${init.serverInfo.version}`,
      );

      return new McpClient(config.name, child, connection, init.serverInfo, init.capabilities);
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  get serverInfo(): McpServerInfo {
    return this.info;
  }

  get capabilities(): McpCapabilities {
    return this.caps;
  }

  /** 处理分页：服务端可能只给一页 */
  async listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]> {
    const tools: McpToolDescriptor[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.connection.request<{
        tools?: McpToolDescriptor[];
        nextCursor?: string;
      }>("tools/list", cursor ? { cursor } : {}, signal);

      tools.push(...(page.tools ?? []));
      cursor = page.nextCursor;
    } while (cursor);

    return tools;
  }

  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallToolResult> {
    return this.connection.request<McpCallToolResult>(
      "tools/call",
      { name, arguments: args },
      signal,
    );
  }

  async listResources(signal?: AbortSignal): Promise<McpResourceDescriptor[]> {
    const page = await this.connection.request<{ resources?: McpResourceDescriptor[] }>(
      "resources/list",
      {},
      signal,
    );
    return page.resources ?? [];
  }

  async readResource(uri: string, signal?: AbortSignal): Promise<McpReadResourceResult> {
    return this.connection.request<McpReadResourceResult>("resources/read", { uri }, signal);
  }

  async close(): Promise<void> {
    this.connection.dispose();
    this.child.stdin?.end();
    this.child.kill();
    await new Promise<void>((resolve) => {
      if (this.child.exitCode !== null) return resolve();
      this.child.once("exit", () => resolve());
      setTimeout(resolve, 2_000);
    });
  }
}
