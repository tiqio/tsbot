/**
 * MCP 端到端演示：本地工具 + 远端工具（另一个进程）在同一个注册表里。
 *
 * 跑法：bun run mcp
 */
import { resolve } from "node:path";
import { Session } from "../context/session";
import { AgentEngine } from "../engine/loop";
import { TerminalReporter } from "../engine/terminal-reporter";
import { mcpToolName, registerMcpTools } from "../mcp/bridge";
import { McpClient } from "../mcp/client";
import { ScriptedProvider } from "../provider/mock";
import { createTools } from "../tools/index";
import { createRegistry } from "../tools/registry";

const workspace = resolve(process.cwd(), "workspace");
const serverPath = resolve(import.meta.dir, "../mcp/server.ts");

console.log("==================================================");
console.log("🔌 MCP 演示：把另一个进程里的工具接进本地注册表");
console.log(`📁 工作区: ${workspace}`);
console.log(`🧩 服务端: src/mcp/server.ts`);
console.log("==================================================");

const client = await McpClient.connect({
  name: "demo",
  command: process.execPath,
  args: [serverPath, "--workspace", workspace],
  timeoutMs: 15_000,
});

const registry = createRegistry();
for (const tool of createTools(workspace)) registry.register(tool);
await registerMcpTools(client, registry);

console.log("\n📋 注册表里的工具（主循环看不出差别）：");
for (const def of registry.getAvailableTools()) {
  const source = def.name.startsWith("mcp__") ? "MCP 远端" : "本地";
  console.log(`   ${def.name.padEnd(28)} ${source}`);
}

// MCP 不只是「工具」：resource 和 prompt 是它比 tool 多出来的两样东西
const resources = await client.listResources();
console.log(`\n📦 资源（resources）：${resources.map((item) => item.name).join(", ")}`);
const ports = await client.readResource("file://ports.md");
console.log(`   读到的内容开头：${(ports.contents?.[0]?.text ?? "").trim().slice(0, 40)}...`);

const session = new Session("mcp_demo", workspace);
session.append({
  role: "user",
  content: "用 MCP 的 list_files 看看工作区，再读 ports.md 告诉我 api-server 在哪个端口。",
});

const provider = new ScriptedProvider([
  {
    role: "assistant",
    content: "先列目录，再读端口登记表。",
    toolCalls: [
      { id: "c1", name: mcpToolName("demo", "list_files"), arguments: {} },
      { id: "c2", name: mcpToolName("demo", "read_file"), arguments: { path: "ports.md" } },
    ],
  },
  { role: "assistant", content: "api-server 监听 8082，nginx 在 80，redis 在 6379。" },
]);

const engine = new AgentEngine(provider, registry, { maxContextChars: 200_000 });

try {
  await engine.run(session, { reporter: new TerminalReporter() });
} finally {
  await client.close();
}

console.log("\n✅ MCP 演示结束，子进程已关闭");
