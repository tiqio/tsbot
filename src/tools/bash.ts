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

export interface RunOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * ch22：把子进程输出解码成字符串。
 *
 * Windows 的 cmd / 老工具经常吐 GBK，直接 toString("utf8") 就是一屏乱码。
 * 先用严格 UTF-8 解一次，失败再退回 GBK；两者都不行就走替换字符。
 */
function decode(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder("gbk").decode(buffer);
    } catch {
      return buffer.toString("utf8");
    }
  }
}

/** 执行一条 shell 命令；工具层和跑分框架都用它，保证行为一致 */
export function runShell(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = TIMEOUT_MS,
): Promise<RunOutcome> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  return new Promise<RunOutcome>((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      windowsHide: true,
      signal: combined,
    });

    // 按 Buffer 收集，最后一次性解码：避免多字节字符被 chunk 边界劈开
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const finish = (exitCode: number | null): void =>
      resolve({
        stdout: decode(Buffer.concat(stdoutChunks)),
        stderr: decode(Buffer.concat(stderrChunks)),
        exitCode,
        timedOut: timeout.aborted,
      });

    child.once("error", (error: Error) => {
      // 被信号中止时 Node 会同时抛 AbortError 和 close 事件
      if (error.name === "AbortError") {
        finish(null);
        return;
      }
      reject(new Error(`启动命令失败: ${error.message}`));
    });

    child.once("close", (code) => finish(code));
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
    const { stdout, stderr, exitCode, timedOut } = await runShell(
      args.command,
      this.workDir,
      ctx.signal,
    );
    const text = render(stdout, stderr, exitCode, timedOut);

    // 非零退出码 / 超时都视为"工具失败"：让 registry 标 isError，
    // 模型才会走 ch14 的救援指南，而不是把错误当成正常输出读过去。
    if (exitCode !== 0 || timedOut) {
      throw new Error(text);
    }
    return text;
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
