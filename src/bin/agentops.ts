/**
 * ch22：AgentOps —— 把同一个引擎接到飞书群里，并给写操作装上人工审批。
 *
 * 与 Go 版的差异：审批中间件需要知道"往哪个群发卡片"，
 * Go 用 context.WithValue 传，这里用 AsyncLocalStorage（feishu/context.ts）。
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Session } from "../context/session";
import { AgentEngine } from "../engine/loop";
import { FeishuBot } from "../feishu/bot";
import { globalApprovalManager, isDangerousCommand } from "../feishu/approval";
import { currentNotifier } from "../feishu/context";
import { CostTracker } from "../observability/tracker";
import { createProvider, detectProviderKind } from "../provider/factory";
import { createTools } from "../tools/index";
import { createRegistry } from "../tools/registry";

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
const kind = detectProviderKind();

if (!appId || !appSecret) {
  console.error("❌ 请设置 FEISHU_APP_ID 与 FEISHU_APP_SECRET");
  process.exit(1);
}
if (kind === "mock") {
  console.error("❌ 请设置模型 API Key（ANTHROPIC_API_KEY / ZHIPU_API_KEY / OPENAI_API_KEY）");
  process.exit(1);
}

const resolved = createProvider(kind);
if (!resolved) {
  console.error(`❌ 无法创建 provider: ${kind}`);
  process.exit(1);
}

const workDir = resolve(process.cwd(), "workspace");
await mkdir(workDir, { recursive: true });

const registry = createRegistry();
for (const tool of createTools(workDir)) registry.register(tool);

// 安全拦截：高危动作挂起，等群里的人 approve / reject
registry.use(async (call) => {
  const args = JSON.stringify(call.arguments ?? {});
  if (!isDangerousCommand(call.name, args)) return { allowed: true };

  console.log(`[Middleware] 拦截到高危操作: ${call.name}，等待人工审批...`);

  const notifier = currentNotifier();
  const result = await globalApprovalManager.waitForApproval(call.id, call.name, args, (text) =>
    notifier ? notifier.notify(text) : console.log(text),
  );

  return result.allowed
    ? { allowed: true }
    : { allowed: false, reason: result.reason };
});

const factory = (session: Session): AgentEngine =>
  new AgentEngine(
    new CostTracker(resolved.provider, resolved.model, session),
    registry,
    { planMode: true },
  );

const bot = new FeishuBot(
  { appId, appSecret, workDir },
  factory,
);

const port = Number(process.env.PORT ?? 48080);
await bot.listen(port);
