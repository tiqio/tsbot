/**
 * ch21：把 CLI 做完整。
 *
 * 这一章不加新机制，只把入口打磨成能日常用的工具：
 * 帮助信息、Ctrl+C 中止、最大轮数、退出码、结束时的账单摘要。
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { globalSessionManager } from "../context/session.ts";
import { AgentEngine } from "../engine/loop.ts";
import { TerminalReporter } from "../engine/terminal-reporter.ts";
import { CostTracker } from "../observability/tracker.ts";
import { createProvider, detectProviderKind } from "../provider/factory.ts";
import { ScriptedProvider } from "../provider/mock.ts";
import type { LLMProvider } from "../provider/types.ts";
import { createReadOnlyTools, createTools } from "../tools/index.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { SubagentTool } from "../tools/subagent.ts";

const USAGE = `tsbot —— 极简智能体驾驭引擎（TypeScript / Bun 版）

用法:
  bun run claw --prompt "你的任务" [选项]

选项:
  --prompt <text>     要交给 Agent 执行的任务（必填）
  --dir <path>        工作区目录，默认当前目录
  --session <id>      会话 ID，默认 cli_default_session
  --provider <kind>   anthropic | zhipu-anthropic | openai | zhipu-openai | mock
                      默认按环境变量自动推断
  --model <name>      覆盖默认模型
  --thinking          开启慢思考两阶段
  --plan              开启 Plan Mode（强制产出 PLAN.md / TODO.md）
  --max-turns <n>     最大轮数，默认不限
  --help              显示本帮助

示例:
  bun run claw --prompt "读一下 nginx.conf，找出 502 的原因" --dir ./workspace
  bun run claw --plan --prompt "把 workspace 里的 notes.md 升级成 v2.0.0 并补一段变更日志"
`;

const { values } = parseArgs({
  options: {
    prompt: { type: "string" },
    dir: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    session: { type: "string" },
    thinking: { type: "boolean" },
    plan: { type: "boolean" },
    "max-turns": { type: "string" },
    help: { type: "boolean" },
  },
});

if (values.help || !values.prompt) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

const workDir = resolve(values.dir ?? process.cwd());
const prompt = values.prompt;
const sessionId = values.session ?? "cli_default_session";
const kind = (values.provider as ReturnType<typeof detectProviderKind>) ?? detectProviderKind();
const maxTurns = values["max-turns"] ? Number(values["max-turns"]) : undefined;

let provider: LLMProvider;
let modelName = "glm-4.5-air";

if (kind === "mock") {
  console.log("⚠️  未检测到 API Key，使用 mock provider（脚本化回放，不调用真实模型）");
  provider = new ScriptedProvider([
    {
      role: "assistant",
      content: "先生成一份笔记，再把里面的版本号改掉。",
      toolCalls: [
        {
          id: "call_write_1",
          name: "write_file",
          arguments: {
            path: "workspace/notes.md",
            content: "# tsbot 工作区\n\n- 版本: v1.0.0\n- 状态: 草稿\n",
          },
        },
        {
          id: "call_edit_1",
          name: "edit_file",
          arguments: {
            path: "workspace/notes.md",
            old_text: "- 版本: v1.0.0",
            new_text: "- 版本: v2.0.0",
          },
        },
      ],
      usage: { promptTokens: 1200, completionTokens: 180 },
    },
    {
      role: "assistant",
      content: "笔记已生成，版本号从 v1.0.0 改成 v2.0.0。",
      usage: { promptTokens: 1500, completionTokens: 60 },
    },
  ]);
} else {
  const resolved = createProvider(kind, values.model);
  if (!resolved) throw new Error(`无法创建 provider: ${kind}`);
  provider = resolved.provider;
  modelName = resolved.model;
}

console.log("==================================================");
console.log("🚀 tsbot CLI");
console.log(`📁 工作区: ${workDir}`);
console.log(`🧠 provider=${kind} model=${modelName}`);
console.log(`💬 会话: ${sessionId}`);
console.log("==================================================");

const registry = new ToolRegistry();
for (const tool of createTools(workDir)) registry.register(tool);

const session = globalSessionManager.getOrCreate(sessionId, workDir);
session.append({ role: "user", content: prompt });

// ch18：装饰器模式，引擎拿到的仍是 LLMProvider
const trackedProvider = new CostTracker(provider, modelName, session);

const engine = new AgentEngine(trackedProvider, registry, {
  enableThinking: values.thinking ?? false,
  planMode: values.plan ?? false,
  maxTurns,
});

// ch17：子智能体工具需要引擎自身，所以只能等引擎建好再挂
const readOnlyRegistry = new ToolRegistry();
for (const tool of createReadOnlyTools(workDir)) readOnlyRegistry.register(tool);
registry.register(new SubagentTool(engine, readOnlyRegistry));

// Ctrl+C 中止：AbortSignal 一路传到 provider 的 fetch 与子进程
const controller = new AbortController();
process.on("SIGINT", () => {
  console.log("\n⚠️  收到 Ctrl+C，正在中止当前任务...");
  controller.abort();
});

let exitCode = 0;
try {
  await engine.run(session, { signal: controller.signal, reporter: new TerminalReporter() });
} catch (error) {
  if (controller.signal.aborted) {
    console.error("\n💥 任务已被用户中止");
  } else {
    console.error(`\n💥 引擎崩溃: ${error instanceof Error ? error.message : String(error)}`);
  }
  exitCode = 1;
}

const totals = session.totals;
console.log("\n==================================================");
console.log(`✨ 任务结束 | 消息 ${session.length} 条`);
console.log(
  `💰 本次会话累计: ¥${totals.costCNY.toFixed(6)} | 输入 ${totals.promptTokens} tk | 输出 ${totals.completionTokens} tk`,
);
console.log("==================================================");

process.exit(exitCode);
