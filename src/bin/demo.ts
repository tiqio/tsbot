/**
 * ch22：离线演示（TS 版额外提供）。
 *
 * 没有 API Key 也能看到整套机制：脚本化的"模型" + 真实的工具 + 真实的审批闸门。
 * 演示在 workspace 的一份临时副本里跑，跑完不动原目录，可以反复执行。
 */
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Session } from "../context/session";
import { AgentEngine } from "../engine/loop";
import { TerminalReporter } from "../engine/terminal-reporter";
import { globalApprovalManager, isDangerousCommand } from "../feishu/approval";
import { CostTracker } from "../observability/tracker";
import { ScriptedProvider } from "../provider/mock";
import { createTools } from "../tools/index";
import { createRegistry } from "../tools/registry";

const template = resolve(process.cwd(), "workspace");
const workDir = await mkdtemp(join(tmpdir(), "tsbot-demo-"));
await cp(template, workDir, { recursive: true });

const provider = new ScriptedProvider([
  {
    role: "assistant",
    content: "先看日志，再核对配置和端口登记表。",
    toolCalls: [
      { id: "call_log", name: "read_file", arguments: { path: "error.log" } },
      { id: "call_conf", name: "read_file", arguments: { path: "nginx.conf" } },
      { id: "call_ports", name: "read_file", arguments: { path: "ports.md" } },
    ],
    usage: { promptTokens: 980, completionTokens: 120 },
  },
  {
    role: "assistant",
    content: "upstream 还指向 8081，登记表说已经迁到 8082。改配置。",
    toolCalls: [
      {
        id: "call_edit",
        name: "edit_file",
        arguments: {
          path: "nginx.conf",
          old_text: "server 127.0.0.1:8081;",
          new_text: "server 127.0.0.1:8082;",
        },
      },
    ],
    usage: { promptTokens: 1420, completionTokens: 96 },
  },
  {
    role: "assistant",
    content: "配置改完，reload 让 Nginx 生效。",
    toolCalls: [
      { id: "call_reload", name: "bash", arguments: { command: "nginx -s reload" } },
    ],
    usage: { promptTokens: 1600, completionTokens: 64 },
  },
  {
    role: "assistant",
    content: `已定位并修复 502：
1. error.log 全是 connect() failed (111: Connection refused) 指向 127.0.0.1:8081；
2. ports.md 显示 api-server 已迁到 8082，nginx.conf 的 upstream 没跟着改；
3. 已用 edit_file 把 upstream 改成 8082。

reload 被审批闸门拦下，批准后才执行；本机没装 nginx，所以这一步如实失败——
错误与救援指南已经回灌给我了。真实服务器上它会生效。`,
    usage: { promptTokens: 2100, completionTokens: 210 },
  },
]);

console.log("==================================================");
console.log("🧪 离线演示：模型是脚本化的，工具/审批/追踪是真的");
console.log(`📁 演示沙箱: ${workDir}`);
console.log("==================================================");

const registry = createRegistry();
for (const tool of createTools(workDir)) registry.register(tool);

// 和 agentops 一样的审批中间件，只是"人类"由定时器扮演
registry.use(async (call) => {
  const args = JSON.stringify(call.arguments ?? {});
  if (!isDangerousCommand(call.name, args)) return { allowed: true };

  const decision = globalApprovalManager.waitForApproval(call.id, call.name, args, (text) =>
    console.log(`\n📨 [审批请求]\n${text}`),
  );

  // 模拟人类在 800ms 后点了"批准"
  const taskId = call.id;
  setTimeout(() => {
    globalApprovalManager.resolveApproval(taskId, true, "演示环境自动批准");
  }, 800);

  const result = await decision;
  return result.allowed ? { allowed: true } : { allowed: false, reason: result.reason };
});

const session = new Session("demo_ops", workDir);
session.append({
  role: "user",
  content: "客户反馈 /api 全挂，报 502，帮我看看 nginx 怎么回事。",
});

const engine = new AgentEngine(new CostTracker(provider, "glm-4.5-air", session), registry, {
  planMode: true,
});

await engine.run(session, { reporter: new TerminalReporter() });

const patched = await readFile(join(workDir, "nginx.conf"), "utf8");
const totals = session.totals;

console.log("==================================================");
console.log(`🔧 upstream 现状: ${patched.match(/server 127\.0\.0\.1:\d+;/)?.[0] ?? "未找到"}`);
console.log(
  `💰 累计: ¥${totals.costCNY.toFixed(6)} | 输入 ${totals.promptTokens} tk | 输出 ${totals.completionTokens} tk`,
);
console.log(`📊 追踪文件在 ${join(workDir, ".claw", "traces")}`);
console.log("==================================================");
