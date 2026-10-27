/**
 * ch09：飞书接入。
 *
 * Go 版用 larksuite/oapi-sdk-go 处理事件分发与消息发送；
 * 这里只用 fetch 直接打两个接口，顺便把 webhook 换成 Bun.serve —— 不到 100 行。
 *
 * 注意：为了保持"从零构建"的可读性，本实现只处理明文事件，
 * 没有做 encrypt_key 的 AES 解密和签名校验。生产环境必须补上。
 */
import { createServer } from "node:http";
import { globalSessionManager } from "../context/session.ts";
import type { Session } from "../context/session.ts";
import type { AgentEngine } from "../engine/loop.ts";
import type { Reporter } from "../engine/reporter.ts";
import { globalApprovalManager } from "./approval.ts";
import { runWithNotifier } from "./context.ts";

const FEISHU_BASE = "https://open.feishu.cn/open-apis";
const MAX_REGISTERED_MESSAGES = 50;

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  workDir: string;
}

/** 极简飞书客户端：tenant_access_token + 发文本消息 */
export class FeishuClient {
  private token = "";
  private tokenExpireAt = 0;
  private handledMessages: string[] = [];

  constructor(private readonly config: FeishuConfig) {}

  private async tenantToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpireAt) return this.token;

    const response = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    const data = (await response.json()) as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };

    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`获取 tenant_access_token 失败: ${data.code} ${data.msg ?? ""}`);
    }

    this.token = data.tenant_access_token;
    this.tokenExpireAt = Date.now() + ((data.expire ?? 7200) - 60) * 1000;
    return this.token;
  }

  async sendText(chatId: string, text: string): Promise<void> {
    const token = await this.tenantToken();
    const response = await fetch(`${FEISHU_BASE}/im/v1/messages?receive_id_type=chat_id`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
    });

    const data = (await response.json()) as { code?: number; msg?: string };
    if (data.code !== 0) {
      throw new Error(`发送飞书消息失败: ${data.code} ${data.msg ?? ""}`);
    }
  }

  /** 飞书会重复投递事件，按 message_id 去重 */
  isHandled(messageId: string): boolean {
    if (this.handledMessages.includes(messageId)) return false;
    this.handledMessages.push(messageId);
    if (this.handledMessages.length > MAX_REGISTERED_MESSAGES) this.handledMessages.shift();
    return true;
  }
}

/** 把 Agent 的每一步同步到飞书会话里 */
export class FeishuReporter implements Reporter {
  constructor(
    private readonly client: FeishuClient,
    private readonly chatId: string,
  ) {}

  onThinking(): void {
    void this.client.sendText(this.chatId, "🤔 模型正在慢思考 (Thinking)...");
  }

  onToolCall(toolName: string, args: string): void {
    void this.client.sendText(this.chatId, `🛠️ 正在执行工具：${toolName}\n参数：${args.slice(0, 500)}`);
  }

  onToolResult(toolName: string, result: string, isError: boolean): void {
    if (isError) {
      void this.client.sendText(this.chatId, `⚠️ 执行报错 (${toolName})：\n${result.slice(0, 800)}`);
      return;
    }
    void this.client.sendText(this.chatId, `✅ 执行成功 (${toolName})`);
  }

  onMessage(content: string): void {
    if (content.trim()) void this.client.sendText(this.chatId, content);
  }

  /** ch22：给审批中间件用的通用通知出口 */
  notify(text: string): void {
    void this.client.sendText(this.chatId, text);
  }
}

interface FeishuEventBody {
  type?: string;
  challenge?: string;
  header?: { event_type?: string; event_id?: string };
  event?: {
    message?: {
      message_id?: string;
      chat_id?: string;
      content?: string;
    };
  };
}

/** 从飞书消息体里抠出纯文本：content 是一段 JSON 字符串 */
export function extractText(content: string | undefined): string {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content) as { text?: string };
    return (parsed.text ?? "").trim();
  } catch {
    return content.trim();
  }
}

export type EngineFactory = (session: Session) => AgentEngine;

export class FeishuBot {
  private readonly client: FeishuClient;

  constructor(
    private readonly config: FeishuConfig,
    private readonly factory: EngineFactory,
  ) {
    this.client = new FeishuClient(config);
  }

  /** 收到普通消息：起一个 Agent 会话，把过程与结果都发回群里 */
  private async handlePrompt(chatId: string, prompt: string): Promise<void> {
    const reporter = new FeishuReporter(this.client, chatId);

    // 每个群一个 Session：上下文彼此隔离，账单也分得清
    const session = globalSessionManager.getOrCreate(chatId, this.config.workDir);
    session.append({ role: "user", content: prompt });

    // ch22：每次请求都新建引擎，让 CostTracker 绑到这个群自己的账本上
    const engine = this.factory(session);

    try {
      // 审批中间件通过 AsyncLocalStorage 拿到"本次请求"的通知出口
      await runWithNotifier(reporter, () => engine.run(session, { reporter }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.client.sendText(chatId, `❌ Agent 运行崩溃: ${message}`);
    }
  }

  /** 处理一次事件回调，返回给飞书 HTTP 层的响应体 */
  async handleEvent(body: FeishuEventBody): Promise<Record<string, unknown>> {
    // URL 校验：飞书要求原样回 challenge
    if (body.type === "url_verification") {
      return { challenge: body.challenge ?? "" };
    }

    const message = body.event?.message;
    if (!message?.chat_id) return { code: 0 };

    if (message.message_id && !this.client.isHandled(message.message_id)) {
      return { code: 0 };
    }

    const text = extractText(message.content);
    if (!text) return { code: 0 };

    console.log(`[Feishu] 收到会话 ${message.chat_id} 的消息: ${text}`);

    // ch16：人工审批口令，直接唤醒挂起的工具调用
    if (text.startsWith("approve ") || text.startsWith("reject ")) {
      const allowed = text.startsWith("approve ");
      const taskId = text.slice(allowed ? "approve ".length : "reject ".length).trim();
      const reason = allowed
        ? "人类管理员已批准操作"
        : "人类管理员认为该操作存在极高风险，已拒绝";

      const matched = globalApprovalManager.resolveApproval(taskId, allowed, reason);
      await this.client.sendText(
        message.chat_id,
        matched
          ? `${allowed ? "✅ 已批准" : "🚫 已拒绝"}任务 ${taskId}`
          : `⚠️ 没有找到待审批的任务 ${taskId}（可能已超时或被处理）`,
      );
      return { code: 0 };
    }

    // 不阻塞 webhook 回调：飞书要求 3 秒内返回
    void this.handlePrompt(message.chat_id, text);
    return { code: 0 };
  }

  /** 启动 webhook 服务 */
  listen(port = 48080): Promise<unknown> {
    return new Promise((resolve) => {
      const server = createServer((request, response) => {
        if (request.method !== "POST") {
          response.writeHead(404).end();
          return;
        }

        let raw = "";
        request.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
        request.on("end", () => {
          void (async () => {
            try {
              const body = JSON.parse(raw || "{}") as FeishuEventBody;
              const result = await this.handleEvent(body);
              response.writeHead(200, { "content-type": "application/json" });
              response.end(JSON.stringify(result));
            } catch (error) {
              const messageText = error instanceof Error ? error.message : String(error);
              console.error(`[Feishu] 处理事件失败: ${messageText}`);
              response.writeHead(500).end(JSON.stringify({ error: messageText }));
            }
          })();
        });
      });

      server.listen(port, () => {
        console.log(`📡 飞书 Webhook 已监听 http://127.0.0.1:${port}/webhook/event`);
        resolve(server);
      });
    });
  }

  get configWorkDir(): string {
    return this.config.workDir;
  }
}
