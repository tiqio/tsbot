/**
 * ch11：会话化。一次 CLI 调用 = 一个 Session 里的若干轮。
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { globalSessionManager } from "../context/session.ts";
import { AgentEngine } from "../engine/loop.ts";
import { TerminalReporter } from "../engine/terminal-reporter.ts";
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
    },
    {
      role: "assistant",
      content: "笔记已生成，版本号从 v1.0.0 改成 v2.0.0。",
    },
  ]);
} else {
  provider = createProvider(kind, values.model)!.provider;
  console.log(`🔌 provider=${kind} model=${values.model ?? "(默认)"}`);
}

const registry = new ToolRegistry();
for (const tool of createTools(workDir)) registry.register(tool);

const session = globalSessionManager.getOrCreate(sessionId, workDir);
session.append({ role: "user", content: prompt });

const engine = new AgentEngine(provider, registry, {
  enableThinking: values.thinking ?? false,
  planMode: values.plan ?? false,
});

// ch17：子智能体工具需要引擎自身，所以只能等引擎建好再挂
const readOnlyRegistry = new ToolRegistry();
for (const tool of createReadOnlyTools(workDir)) readOnlyRegistry.register(tool);
registry.register(new SubagentTool(engine, readOnlyRegistry));

await engine.run(session, { reporter: new TerminalReporter() });

console.log(`\n[Session ${session.id}] 共 ${session.length} 条消息，工作区 ${session.workDir}`);
