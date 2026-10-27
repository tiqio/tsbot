/**
 * 把 MCP 工具接进本地 Registry。
 *
 * 这是整个 MCP 集成的关键一步：**桥接之后，主循环完全分不出哪个工具在本地、
 * 哪个在另一个进程里**。区别只体现在三处：名字前缀、schema 来源、执行边界。
 */
import { z } from "zod";
import type { Registry } from "../tools/registry";
import { defineTool } from "../tools/tool";
import type { McpClient } from "./client";
import type { McpCallToolResult, McpContentBlock, JsonSchema } from "./types";

/** 名字前缀，避免和本地工具撞车（也方便在日志里一眼看出是远端） */
export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

/**
 * MCP 用 JSON Schema 描述入参，我们的 Tool 用 zod。
 * zod 4 自带 fromJSONSchema，能把它转回来 —— 这样远端工具的参数校验、
 * 以及再回推给模型的 schema，都走和本地工具完全一样的链路。
 */
function toZodSchema(inputSchema: JsonSchema | undefined): z.ZodType {
  if (!inputSchema) return z.record(z.string(), z.unknown());

  try {
    const schema = z.fromJSONSchema(inputSchema);
    // 顶层必须是对象，否则 registry 传进来的 arguments 形状对不上
    return schema instanceof z.ZodObject ? schema : z.record(z.string(), z.unknown());
  } catch {
    // 服务端给了我们转不了的 schema（$ref、oneOf 之类），退化成"原样透传"：
    // 校验交给服务端，客户端不假装自己懂。
    return z.record(z.string(), z.unknown());
  }
}

/** MCP 返回的是内容块数组，Agent 需要的是文本 */
export function renderContent(blocks: McpContentBlock[] | undefined): string {
  if (!blocks?.length) return "";

  return blocks
    .map((block) => {
      if (block.type === "text") return block.text ?? "";
      if (block.type === "image") {
        return `[image ${block.mimeType ?? "unknown"}，${block.data?.length ?? 0} 个 base64 字符]`;
      }
      if (block.type === "resource") {
        return block.resource?.text ?? `[resource ${block.resource?.uri ?? ""}]`;
      }
      if (block.type === "resource_link") return `[resource_link ${block.uri ?? ""}]`;
      return JSON.stringify(block);
    })
    .join("\n");
}

export interface BridgeOptions {
  signal?: AbortSignal;
}

/** 把某个服务端的全部工具注册进 registry，返回注册数量 */
export async function registerMcpTools(
  client: McpClient,
  registry: Registry,
  options: BridgeOptions = {},
): Promise<number> {
  if (client.capabilities.tools === undefined) {
    console.log(`[mcp:${client.name}] 服务端没有声明 tools 能力，跳过`);
    return 0;
  }

  const tools = await client.listTools(options.signal);
  let count = 0;

  for (const tool of tools) {
    registry.register(
      defineTool({
        name: mcpToolName(client.name, tool.name),
        description: `[MCP:${client.name}] ${tool.description ?? tool.name}`,
        schema: toZodSchema(tool.inputSchema),
        async run(args, ctx) {
          const result: McpCallToolResult = await client.callTool(
            tool.name,
            (args ?? {}) as Record<string, unknown>,
            ctx.signal,
          );

          const text = renderContent(result.content);
          if (result.isError) {
            throw new Error(text || `MCP 工具 ${tool.name} 返回错误`);
          }
          return text;
        },
      }),
    );
    count++;
  }

  console.log(`[mcp:${client.name}] 已桥接 ${count} 个工具`);
  return count;
}
