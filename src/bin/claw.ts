/**
 * ch05：挂上第一个真工具（read_file），其余仍是 mock provider。
 */
import { parseArgs } from "node:util";
import { AgentEngine } from "../engine/loop.ts";
import { createProvider, detectProviderKind } from "../provider/factory.ts";
import { ScriptedProvider } from "../provider/mock.ts";
import type { LLMProvider } from "../provider/types.ts";
import { ReadFileTool } from "../tools/read-file.ts";
import { ToolRegistry } from "../tools/registry.ts";

const { values } = parseArgs({
  options: {
    prompt: { type: "string" },
    dir: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
  },
});

const workDir = values.dir ?? process.cwd();
const prompt = values.prompt ?? "帮我读一下 README.md，告诉我这是什么东西。";
const kind = (values.provider as ReturnType<typeof detectProviderKind>) ?? detectProviderKind();

let provider: LLMProvider;
if (kind === "mock") {
  console.log("⚠️  未检测到 API Key，使用 mock provider（脚本化回放，不调用真实模型）");
  provider = new ScriptedProvider([
    {
      role: "assistant",
      content: "先读一下 README.md。",
      toolCalls: [
        { id: "call_read_1", name: "read_file", arguments: { path: "README.md" } },
      ],
    },
    {
      role: "assistant",
      content: "README 说明这是一个把 go-tiny-claw 移植到 TypeScript / Bun 的项目。",
    },
  ]);
} else {
  provider = createProvider(kind, values.model)!.provider;
  console.log(`🔌 provider=${kind} model=${values.model ?? "(默认)"}`);
}

const registry = new ToolRegistry();
registry.register(new ReadFileTool(workDir));

const engine = new AgentEngine(provider, registry, { workDir });
await engine.run(prompt);
