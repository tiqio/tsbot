/**
 * ch02：先用 mock 把循环跑通，还没有真实模型。
 * 对应 Go 版 cmd/claw/main.go 里的 mockProvider / mockRegistry。
 */
import { AgentEngine } from "../engine/loop.ts";
import type { LLMProvider } from "../provider/types.ts";
import type { Message, ToolCall, ToolDefinition, ToolResult } from "../schema/message.ts";
import type { Registry } from "../tools/registry.ts";

class MockProvider implements LLMProvider {
  private turn = 0;

  async generate(): Promise<Message> {
    this.turn++;
    if (this.turn === 1) {
      return {
        role: "assistant",
        content: "让我来看看当前目录下有什么文件。",
        toolCalls: [
          { id: "call_123", name: "bash", arguments: { command: "ls -la" } },
        ],
      };
    }
    return {
      role: "assistant",
      content: "我看到了文件列表，里面包含 main.go，任务完成！",
    };
  }
}

class MockRegistry implements Registry {
  getAvailableTools(): ToolDefinition[] {
    return [];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    return {
      toolCallId: call.id,
      output: "-rw-r--r--  1 user group  234 Oct 24 10:00 main.go\n",
      isError: false,
    };
  }
}

const engine = new AgentEngine(new MockProvider(), new MockRegistry(), process.cwd());
await engine.run("帮我检查当前目录的文件");
