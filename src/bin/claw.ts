/**
 * ch03：加入慢思考两阶段后，mock 也要能扮演"先思考、再行动"。
 */
import { AgentEngine } from "../engine/loop.ts";
import type { LLMProvider } from "../provider/types.ts";
import type { Message, ToolCall, ToolDefinition, ToolResult } from "../schema/message.ts";
import type { Registry } from "../tools/registry.ts";

class MockProvider implements LLMProvider {
  private calledTool = false;

  async generate(
    _messages: Message[],
    tools: ToolDefinition[],
  ): Promise<Message> {
    // tools 为空 = Thinking 阶段
    if (tools.length === 0) {
      return {
        role: "assistant",
        content:
          "任务是看一眼当前目录。计划：调用 bash 执行 ls -la，然后根据输出总结。",
      };
    }

    if (!this.calledTool) {
      this.calledTool = true;
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
    return [
      {
        name: "bash",
        description: "执行 bash 命令",
        inputSchema: { type: "object", properties: { command: { type: "string" } } },
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    return {
      toolCallId: call.id,
      output: "-rw-r--r--  1 user group  234 Oct 24 10:00 main.go\n",
      isError: false,
    };
  }
}

const engine = new AgentEngine(new MockProvider(), new MockRegistry(), {
  workDir: process.cwd(),
  enableThinking: true,
});

await engine.run("帮我检查当前目录的文件");
