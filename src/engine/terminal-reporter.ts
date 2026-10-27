/**
 * ch09：终端 Reporter —— ANSI 上色，参数与输出都做截断。
 */
import type { Reporter } from "./reporter.ts";

const colorEnabled = process.stdout.isTTY === true && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) =>
  colorEnabled ? `\x1b[${code}m${text}\x1b[0m` : text;

const dim = paint("2");
const cyan = paint("36");
const red = paint("31");
const green = paint("32");

const MAX_ARGS = 150;
const MAX_RESULT = 300;

function clip(text: string, max: number): string {
  const oneLine = text.replaceAll("\n", "\\n").replaceAll("\r", "\\r");
  return oneLine.length > max ? `${oneLine.slice(0, max)}... (已截断)` : oneLine;
}

export class TerminalReporter implements Reporter {
  onThinking(): void {
    console.log(cyan("\n[🤔 思考中] 模型正在推理..."));
  }

  onToolCall(toolName: string, args: string): void {
    console.log(`[🛠️ 调用工具] ${toolName}`);
    console.log(dim(`   参数: ${clip(args, MAX_ARGS)}`));
  }

  onToolResult(toolName: string, result: string, isError: boolean): void {
    if (isError) {
      console.log(red(`[❌ 执行失败] ${toolName}`));
      if (result) console.log(dim(`   ${clip(result, MAX_RESULT)}`));
      return;
    }
    console.log(green(`[✅ 执行成功] ${toolName}`));
  }

  onMessage(content: string): void {
    if (!content.trim()) return;
    console.log(`\n🤖 Agent 回复:\n${content}\n`);
  }
}
