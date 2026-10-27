/**
 * MCP（Model Context Protocol）协议里我们会用到的那些形状。
 *
 * 只声明 tsbot 真正消费的字段：MCP 规范比这里大得多（采样、roots、进度、
 * 音频内容、订阅……），但这个 harness 只需要「列工具 / 调工具 / 读资源」。
 */

/** 我们支持的最新协议版本；服务端可以回一个别的，客户端只告警不拒绝 */
export const PROTOCOL_VERSION = "2025-06-18";

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON Schema 片段（MCP 用 JSON Schema 描述入参，不是 zod） */
export type JsonSchema = Record<string, unknown>;

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

export interface McpContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  resource?: { uri?: string; mimeType?: string; text?: string };
}

export interface McpCallToolResult {
  content?: McpContentBlock[];
  isError?: boolean;
  structuredContent?: unknown;
}

export interface McpResourceDescriptor {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpReadResourceResult {
  contents?: Array<{ uri?: string; mimeType?: string; text?: string; blob?: string }>;
}

export interface McpServerInfo {
  name: string;
  version: string;
  title?: string;
}

export interface McpCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  [key: string]: unknown;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: McpCapabilities;
  serverInfo: McpServerInfo;
  instructions?: string;
}

/** 启动一个 MCP 服务端进程所需的最小信息 */
export interface McpServerConfig {
  /** 给日志和工具名前缀用的短名 */
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** 单次请求超时，默认 30s；工具调用通常更慢，可单独覆盖 */
  timeoutMs?: number;
}
