/**
 * MCP 探针：连任意 MCP 服务端，把它的能力清单打出来；可以顺便调一个工具。
 *
 * 用法：
 *   bun run mcp:probe -- npx -y @modelcontextprotocol/server-everything
 *   bun run mcp:probe -- node ./my-server.js --call echo '{"text":"hi"}'
 *   MCP_DEBUG=1 bun run mcp:probe -- ...        # 打印原始 JSON-RPC 报文
 */
import { mcpToolName } from "../mcp/bridge";
import { McpClient } from "../mcp/client";
import { createRegistry } from "../tools/registry";
import { registerMcpTools } from "../mcp/bridge";

const argv = process.argv.slice(2);

let call: { name: string; args: Record<string, unknown> } | undefined;
const callIndex = argv.indexOf("--call");
if (callIndex >= 0) {
  const name = argv[callIndex + 1];
  if (!name) {
    console.error("--call 后面要跟工具名");
    process.exit(1);
  }

  // 参数支持两种写法：JSON（'{"path":"x"}'）或 key=value（Windows 的 PowerShell
  // 会把内部双引号吃掉，所以 k=v 更稳）
  const raw: string[] = [];
  for (let i = callIndex + 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token || token.startsWith("--")) break;
    raw.push(token);
  }

  let args: Record<string, unknown> = {};
  const joined = raw.join(" ");
  if (joined.trim().startsWith("{")) {
    args = JSON.parse(joined) as Record<string, unknown>;
  } else {
    for (const pair of raw) {
      const [key, ...rest] = pair.split("=");
      if (!key) continue;
      const value = rest.join("=");
      args[key] = value === "true" ? true : value === "false" ? false : Number.isNaN(Number(value)) || value === "" ? value : Number(value);
    }
  }

  call = { name, args };
  argv.splice(callIndex, 2 + raw.length);
}

const commandLine = argv[0] === "--" ? argv.slice(1) : argv;
const [command, ...args] = commandLine;

if (!command) {
  console.error(
    "用法: bun run mcp:probe -- <启动命令> [参数...] [--call <工具名> '<json 参数>']",
  );
  process.exit(1);
}

const client = await McpClient.connect({ name: "probe", command, args, timeoutMs: 30_000 });

try {
  console.log("\n================ 服务端信息 ================");
  console.log(`name     : ${client.serverInfo.name}@${client.serverInfo.version}`);
  console.log(`protocol : ${client.protocolVersion}`);
  console.log(`caps     : ${JSON.stringify(client.capabilities)}`);

  if (client.capabilities.tools) {
    const tools = await client.listTools();
    console.log(`\n================ 工具 (${tools.length}) ================`);
    for (const tool of tools) {
      const required = (tool.inputSchema?.required as string[] | undefined) ?? [];
      const params = required.length ? `  必填: ${required.join(", ")}` : "";
      console.log(`- ${tool.name}${params}`);
      if (tool.description) console.log(`  ${tool.description.split("\n")[0]?.slice(0, 100)}`);
    }
  }

  if (client.capabilities.resources) {
    const resources = await client.listResources().catch(() => []);
    console.log(`\n================ 资源 (${resources.length}) ================`);
    for (const resource of resources) {
      console.log(`- ${resource.uri}  ${resource.name ?? ""}`);
    }
  }

  if (call) {
    console.log(`\n================ 调用 ${call.name} ================`);
    const result = await client.callTool(call.name, call.args);
    const text = (result.content ?? [])
      .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
      .join("\n");
    console.log(text.slice(0, 2000));
    if (result.isError) console.log("(isError = true)");
  }

  // 顺手验证桥接：注册进本地 registry，看看定义长什么样
  const registry = createRegistry();
  const count = await registerMcpTools(client, registry);
  if (count > 0) {
    const first = registry.getAvailableTools()[0];
    console.log("\n================ 桥接后的第一个工具 ================");
    console.log(`name    : ${first?.name}`);
    console.log(`schema  : ${JSON.stringify(first?.inputSchema).slice(0, 300)}`);
    console.log(`(本地名字前缀: ${mcpToolName("probe", "<tool>")})`);
  }
} finally {
  await client.close();
}
