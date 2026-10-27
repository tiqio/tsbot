/**
 * ch18：CLI 入口接入成本追踪。到这里，claw 的装配已经接近最终形态。
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

const { values } = parseArgs({
  options: {
    prompt: { type: "string" },
    dir: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    session: { type: "string" },
    thinking: { type: "boolean" },
    plan: { type: "boolean" },
  },
});

const workDir = resolve(values.dir ?? process.cwd());
const prompt = values.prompt ?? "在工作区生成一份 notes.md，并把版本号改成 v2.0.0。";
const sessionId = values.session ?? "cli_default_session";
const kind = (values.provider as ReturnType<typeof detectProviderKind>) ?? detectProviderKind();

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
  console.log(`🔌 provider=${kind} model=${modelName}`);
}

const registry = new ToolRegistry();
for (const tool of createTools(workDir)) registry.register(tool);

const session = globalSessionManager.getOrCreate(sessionId, workDir);
session.append({ role: "user", content: prompt });

// ch18：装饰器模式，引擎拿到的仍是 LLMProvider
const trackedProvider = new CostTracker(provider, modelName, session);

const engine = new AgentEngine(trackedProvider, registry, {
  enableThinking: values.thinking ?? false,
  planMode: values.plan ?? false,
});

// ch17：子智能体工具需要引擎自身，所以只能等引擎建好再挂
const readOnlyRegistry = new ToolRegistry();
for (const tool of createReadOnlyTools(workDir)) readOnlyRegistry.register(tool);
registry.register(new SubagentTool(engine, readOnlyRegistry));

await engine.run(session, { reporter: new TerminalReporter() });

const totals = session.totals;
console.log("\n==================================================");
console.log(`✨ 任务结束 | 消息 ${session.length} 条`);
console.log(
  `💰 本次会话累计: ¥${totals.costCNY.toFixed(6)} | 输入 ${totals.promptTokens} tk | 输出 ${totals.completionTokens} tk`,
);
console.log("==================================================");
