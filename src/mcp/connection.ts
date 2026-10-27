/**
 * JSON-RPC 2.0 over 换行分隔的 stdio。
 *
 * 这一层只做四件事：编号、配对、超时、取消。
 * 协议语义（initialize / tools/*）在 client.ts 里，互不耦合。
 */
import type { JsonRpcErrorBody } from "./types";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JsonRpcMessage {
  jsonrpc?: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcErrorBody;
}

export interface ConnectionOptions {
  timeoutMs?: number;
  /** 服务端主动发来的通知（如 notifications/tools/list_changed） */
  onNotification?: (method: string, params: unknown) => void;
  /** 连接断开（进程退出、管道关闭） */
  onClose?: (error?: Error) => void;
  /** 服务端 stderr 的每一行，通常用来转发日志 */
  onStderr?: (line: string) => void;
}

export class JsonRpcConnection {
  private nextId = 1;
  private buffer = "";
  private readonly pending = new Map<number, Pending>();
  private closed = false;
  private readonly timeoutMs: number;

  constructor(
    private readonly input: NodeJS.ReadableStream,
    private readonly output: NodeJS.WritableStream,
    private readonly options: ConnectionOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 30_000;

    this.input.setEncoding("utf8");
    this.input.on("data", (chunk: string) => this.onData(chunk));
    this.input.on("close", () => this.fail(new Error("MCP 连接已关闭")));
    this.input.on("error", (error: Error) => this.fail(error));
  }

  /** 发一个请求并等待响应；signal 触发时按 MCP 规范发 notifications/cancelled */
  request<T>(method: string, params?: unknown, signal?: AbortSignal): Promise<T> {
    if (this.closed) return Promise.reject(new Error("MCP 连接已关闭"));

    const id = this.nextId++;
    const payload = { jsonrpc: "2.0" as const, id, method, ...(params === undefined ? {} : { params }) };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时（${method}, ${this.timeoutMs}ms）`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });

      const onAbort = (): void => {
        this.settle(id);
        this.notify("notifications/cancelled", { requestId: id, reason: "客户端取消" });
        reject(new Error(`MCP 请求已取消（${method}）`));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      this.write(payload);
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  /** 回响应给服务端发来的请求（本 harness 用不上，留作对称实现） */
  respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  dispose(): void {
    this.fail(new Error("MCP 连接已释放"));
  }

  private write(message: unknown): void {
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;

    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.dispatch(line);
      index = this.buffer.indexOf("\n");
    }
  }

  private dispatch(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.options.onStderr?.(`[mcp] 无法解析的报文: ${line.slice(0, 200)}`);
      return;
    }

    // 服务端发来的请求：本 harness 不实现，回一个"不支持"
    if (typeof message.method === "string" && message.id !== undefined && message.id !== null) {
      this.write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `客户端不支持 ${message.method}` },
      });
      return;
    }

    if (typeof message.method === "string") {
      this.options.onNotification?.(message.method, message.params);
      return;
    }

    const id = typeof message.id === "number" ? message.id : Number(message.id);
    const pending = this.pending.get(id);
    if (!pending) return;

    this.settle(id);

    if (message.error) {
      pending.reject(new Error(`${message.error.message} (code ${message.error.code})`));
      return;
    }
    pending.resolve(message.result);
  }

  private settle(id: number): Pending | undefined {
    const pending = this.pending.get(id);
    if (!pending) return undefined;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    return pending;
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
    this.options.onClose?.(error);
  }
}
