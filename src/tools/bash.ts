/**
 * ch06：bash 工具 —— 整套 Harness 里唯一的"图灵完备"原语。
 *
 * 与 Go 版的两点差异：
 * 1. `shell: true` 由 Node 负责把命令交给正确的 shell，
 *    在 Windows 上是 cmd.exe，在 POSIX 上是 /bin/sh —— 不用自己拼参数，
 *    否则 `node -p "a b"` 这种带引号的命令会被 Windows 的 argv 转义规则吃掉引号。
 * 2. 超时和取消统一走 AbortSignal：超时 kill 进程，然后仍然等待 close 事件，
 *    确保不会留下孤儿进程。
 */
import { spawn } from "node:child_process";
import { z } from "zod";
import type { Tool } from "./tool.ts";

const schema = z.object({
  command: z.string().describe("要执行的 shell 命令，支持 && 等链式语法"),
});

const MAX_BYTES = 8000;
const TIMEOUT_MS = 30_000;

interface RunOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

function run(command: string, cwd: string, signal?: AbortSignal): Promise<RunOutcome> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  return new Promise<RunOutcome>((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      windowsHide: true,
      signal: combined,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));

    child.once("error", (error: Error & { code?: string }) => {
      // 被信号中止时 Node 会同时抛 AbortError 和 close 事件
      if (error.name === "AbortError") {
        resolve({ stdout, stderr, exitCode: null, timedOut: timeout.aborted });
        return;
      }
      reject(new Error(`启动命令失败: ${error.message}`));
    });

    child.once("close", (code) => {
      resolve({ stdout, stderr, exitCode: code, timedOut: timeout.aborted });
    });
  });
}

export class BashTool implements Tool<typeof schema> {
  readonly name = "bash";
  readonly description =
    "在当前工作区执行任意的 shell 命令。支持链式命令(如 &&)。返回标准输出和标准错误。";
  readonly schema = schema;

  constructor(private readonly workDir: string) {}

  async execute(
    args: z.infer<typeof schema>,
    ctx: { signal?: AbortSignal } = {},
  ): Promise<string> {
    const { stdout, stderr, exitCode, timedOut } = await run(
      args.command,
      this.workDir,
      ctx.signal,
    );
    return render(stdout, stderr, exitCode, timedOut);
  }
}

function render(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  timedOut: boolean,
): string {
  const merged = `${stdout}${stderr}`.trimEnd();

  if (timedOut) {
    return `${merged}\n[警告: 命令执行超时(${TIMEOUT_MS / 1000}s)，已被系统强制终止。]`;
  }
  if (exitCode !== 0) {
    return `执行报错: 退出码 ${exitCode ?? 1}\n输出:\n${merged}`;
  }
  if (merged === "") {
    return "命令执行成功，无终端输出。";
  }
  if (merged.length > MAX_BYTES) {
    return `${merged.slice(0, MAX_BYTES)}\n\n...[终端输出过长，已截断至前 ${MAX_BYTES} 字节]...`;
  }
  return merged;
}
