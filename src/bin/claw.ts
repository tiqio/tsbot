/**
 * ch04：接入真实模型。此时工具还是假的（get_weather），
 * 目的是先把"协议适配"这层单独验证通过。
 */
import { parseArgs } from "node:util";
import { AgentEngine } from "../engine/loop.ts";
import { createProvider, detectProviderKind } from "../provider/factory.ts";
import { ScriptedProvider } from "../provider/mock.ts";
import type { LLMProvider } from "../provider/types.ts";
import type { ToolCall, ToolDefinition, ToolResult } from "../schema/message.ts";
import type { Registry } from "../tools/registry.ts";

class MockRegistry implements Registry {
  getAvailableTools(): ToolDefinition[] {
    return [
      {
        name: "get_weather",
        description: "获取指定城市的当前天气情况。",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    console.log(`  -> [Mock 工具执行] ${call.name}(${JSON.stringify(call.arguments)})`);
    return {
      toolCallId: call.id,
      output: "API 返回：今天是晴天，气温 25 度。",
      isError: false,
    };
  }
}

const { values } = parseArgs({
  options: {
    prompt: { type: "string" },
    dir: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
  },
});

const workDir = values.dir ?? process.cwd();
const prompt = values.prompt ?? "我想去北京跑步，帮我查查天气适合吗？";
const kind = (values.provider as ReturnType<typeof detectProviderKind>) ?? detectProviderKind();

let provider: LLMProvider;
if (kind === "mock") {
  console.log("⚠️  未检测到 API Key，使用 mock provider（脚本化回放，不调用真实模型）");
  provider = new ScriptedProvider([
    {
      role: "assistant",
      content: "北京今天的天气如何？我先查一下。",
      toolCalls: [{ id: "call_weather_1", name: "get_weather", arguments: { city: "北京" } }],
    },
    {
      role: "assistant",
      content: "北京晴天 25 度，湿度适中，适合跑步。建议傍晚出发。",
    },
  ]);
} else {
  provider = createProvider(kind, values.model)!.provider;
  console.log(`🔌 provider=${kind} model=${values.model ?? "(默认)"}`);
}

const engine = new AgentEngine(provider, new MockRegistry(), { workDir });
await engine.run(prompt);
