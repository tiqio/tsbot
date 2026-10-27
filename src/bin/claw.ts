/**
 * ch06：注册 read / write / bash 三个原语。
 */
import { parseArgs } from "node:util";
import { AgentEngine } from "../engine/loop.ts";
import { createProvider, detectProviderKind } from "../provider/factory.ts";
import { ScriptedProvider } from "../provider/mock.ts";
import type { LLMProvider } from "../provider/types.ts";
import { createTools } from "../tools/index.ts";
import { ToolRegistry } from "../tools/registry.ts";

const { values } = parseArgs({
  options: {
    prompt: { type: "string" },
    dir: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    thinking: { type: "boolean" },
  },
});

const workDir = values.dir ?? process.cwd();
const prompt = values.prompt ?? "先看看 README，再用 bash 确认一下当前目录。";
const kind = (values.provider as ReturnType<typeof detectProviderKind>) ?? detectProviderKind();

let provider: LLMProvider;
if (kind === "mock") {
  console.log("⚠️  未检测到 API Key，使用 mock provider（脚本化回放，不调用真实模型）");
  provider = new ScriptedProvider([
    {
      role: "assistant",
      content: "先读 README，再确认一下当前目录。",
      toolCalls: [
        { id: "call_read_1", name: "read_file", arguments: { path: "README.md" } },
        { id: "call_bash_1", name: "bash", arguments: { command: "echo tsbot-ok" } },
      ],
    },
    {
      role: "assistant",
      content: "README 是项目说明，bash 输出 tsbot-ok，环境正常。",
    },
  ]);
} else {
  provider = createProvider(kind, values.model)!.provider;
  console.log(`🔌 provider=${kind} model=${values.model ?? "(默认)"}`);
}

const registry = new ToolRegistry();
for (const tool of createTools(workDir)) registry.register(tool);

const engine = new AgentEngine(provider, registry, {
  workDir,
  enableThinking: values.thinking ?? false,
});
await engine.run(prompt);
