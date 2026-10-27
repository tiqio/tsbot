#!/usr/bin/env bun
/**
 * 一个极简但守规矩的 MCP 服务端（stdio），给 demo 和测试用。
 *
 * 实现的方法：
 *   initialize / notifications/initialized / ping
 *   tools/list / tools/call
 *   resources/list / resources/read
 *   prompts/list / prompts/get
 *
 * 两处刻意的教学点：
 * 1. 「工具执行失败」用 isError 的 content 返回，不是 JSON-RPC error；
 *    「协议级失败」（方法不存在、参数缺失）才回 -32601 / -32602。
 * 2. 日志一律写 stderr——stdout 是协议通道，混一行日志就会让客户端解析炸掉。
 */
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { PROTOCOL_VERSION } from "./types";

const argv = process.argv.slice(2);
const workspaceArg = argv.includes("--workspace") ? argv[argv.indexOf("--workspace") + 1] : undefined;
const workspace = resolve(workspaceArg ?? resolve(process.cwd(), "workspace"));

const log = (text: string): void => {
  process.stderr.write(`[server] ${text}\n`);
};

const TOOLS = [
  {
    name: "list_files",
    description: "列出工作区某个目录下的文件（不递归）。",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "相对工作区的目录，默认 ." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description: "读取工作区里的文本文件，超过 8000 字节会截断。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对工作区的路径" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
] as const;

const RESOURCES = [
  { uri: "file://ports.md", name: "ports.md", mimeType: "text/markdown", description: "服务端口登记表" },
  { uri: "file://error.log", name: "error.log", mimeType: "text/plain", description: "Nginx 错误日志" },
];

/** 服务端也要守边界：MCP 不是"给个路径就随便读"的借口 */
function insideWorkspace(path: string): string {
  const target = resolve(workspace, path);
  const rel = relative(workspace, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`路径越界: ${path}`);
  }
  return target;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}> {
  try {
    if (name === "list_files") {
      const dir = typeof args.dir === "string" ? args.dir : ".";
      const entries = await readdir(insideWorkspace(dir), { withFileTypes: true });
      const lines = entries
        .slice(0, 200)
        .map((entry) => `${entry.isDirectory() ? "[dir]" : "[file]"} ${entry.name}`);
      return { content: [{ type: "text", text: lines.join("\n") || "（空目录）" }] };
    }

    if (name === "read_file") {
      if (typeof args.path !== "string") throw new Error("缺少 path 参数");
      const buffer = await readFile(insideWorkspace(args.path));
      const text =
        buffer.byteLength > 8000
          ? `${buffer.subarray(0, 8000).toString("utf8")}\n...[已截断]`
          : buffer.toString("utf8");
      return { content: [{ type: "text", text }] };
    }

    // 工具级失败：让模型看到原因并自己改
    return { content: [{ type: "text", text: `未知的工具: ${name}` }], isError: true };
  } catch (error) {
    return {
      content: [{ type: "text", text: `执行失败: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id: unknown, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id: unknown, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} },
        serverInfo: { name: "tsbot-demo-server", version: "1.0.0", title: "tsbot MCP 示例" },
        instructions: "工作区里模拟了一台小服务器的配置与日志。",
      };

    case "ping":
      return {};

    case "tools/list":
      return { tools: TOOLS };

    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string") throw new Error("tools/call 缺少 name");
      if (!TOOLS.some((tool) => tool.name === name)) {
        throw Object.assign(new Error(`未知工具: ${name}`), { rpcCode: -32602 });
      }
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      return callTool(name, args);
    }

    case "resources/list":
      return { resources: RESOURCES };

    case "resources/read": {
      const uri = String(params.uri ?? "");
      const name = RESOURCES.find((item) => item.uri === uri)?.name;
      if (!name) throw Object.assign(new Error(`没有这个资源: ${uri}`), { rpcCode: -32602 });
      const text = await readFile(join(workspace, name), "utf8").catch(() => "（文件不存在）");
      return { contents: [{ uri, mimeType: "text/plain", text }] };
    }

    case "prompts/list":
      return {
        prompts: [
          {
            name: "diagnose_502",
            description: "按 SOP 排查一次 Nginx 502",
          },
        ],
      };

    case "prompts/get":
      return {
        description: "Nginx 502 排查",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "先读 error.log 的最后 20 行，再核对 ports.md 与 nginx.conf 的 upstream 端口，给出结论。",
            },
          },
        ],
      };

    default:
      throw Object.assign(new Error(`不支持的方法: ${method}`), { rpcCode: -32601 });
  }
}

async function onMessage(line: string): Promise<void> {
  let message: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    message = JSON.parse(line) as typeof message;
  } catch {
    respondError(null, -32700, "解析失败");
    return;
  }

  // 通知（没有 id）不需要响应
  if (message.method && message.id === undefined) {
    if (message.method === "notifications/initialized") log("握手完成");
    return;
  }

  if (!message.method) {
    respondError(message.id ?? null, -32600, "无效请求");
    return;
  }

  try {
    const result = await handle(message.method, message.params ?? {});
    respond(message.id, result);
  } catch (error) {
    const code = (error as { rpcCode?: number }).rpcCode ?? -32603;
    respondError(message.id, code, error instanceof Error ? error.message : String(error));
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;

  let index = buffer.indexOf("\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) void onMessage(line);
    index = buffer.indexOf("\n");
  }
});

process.stdin.on("end", () => {
  log("stdin 关闭，退出");
  process.exit(0);
});

log(`已启动，工作区 ${workspace}`);
