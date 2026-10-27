/**
 * bash 工具 —— 整套 Harness 里唯一的"图灵完备"原语。
 *
 * 用 node:child_process + shell:true，由 Node 负责把命令交给正确的 shell：
 * Windows 上是 cmd.exe，POSIX 上是 /bin/sh。自己拼 argv 会被 Windows 的引号
 * 规则吃掉（Bun.spawn 传 `node -p "a b"` 就踩过）。
 *
 * 超时与取消统一走 AbortSignal；kill 后仍等待 close，避免孤儿进程。
 */
import { spawn } from "node:child_process";
import { z } from "zod";
import { defineTool } from "./tool";

const MAX_BYTES = 8000;
const TIMEOUT_MS = 30_000;

export interface RunOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * 子进程输出解码：Windows 的 cmd 常吐 GBK，直接 toString("utf8") 就是乱码。
 * 先严格 UTF-8 解一次，失败再退回 GBK。
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
    const child = spawn(command, { shell: true, cwd, windowsHide: true, signal: combined });

    // 按 Buffer 收集，最后一次性解码：避免多字节字符被 chunk 边界劈开
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    const finish = (exitCode: number | null): void =>
      resolve({
        stdout: decode(Buffer.concat(stdout)),
        stderr: decode(Buffer.concat(stderr)),
        exitCode,
        timedOut: timeout.aborted,
      });

    child.once("error", (error: Error) => {
      // 被信号中止时 Node 会同时抛 AbortError 和 close 事件
      if (error.name === "AbortError") return finish(null);
      reject(new Error(`启动命令失败: ${error.message}`));
    });

    child.once("close", (code) => finish(code));
  });
}

function render(outcome: RunOutcome): string {
  const { exitCode, timedOut } = outcome;
  const merged = `${outcome.stdout}${outcome.stderr}`.trimEnd();

  if (timedOut) {
    return `${merged}\n[警告: 命令执行超时(${TIMEOUT_MS / 1000}s)，已被系统强制终止。]`;
  }
  if (exitCode !== 0) {
    return `执行报错: 退出码 ${exitCode ?? 1}\n输出:\n${merged}`;
  }
  if (merged === "") return "命令执行成功，无终端输出。";
  if (merged.length > MAX_BYTES) {
    return `${merged.slice(0, MAX_BYTES)}\n\n...[终端输出过长，已截断至前 ${MAX_BYTES} 字节]...`;
  }
  return merged;
}

export const bashTool = (workDir: string) =>
  defineTool({
    name: "bash",
    description:
      "在当前工作区执行任意的 shell 命令。支持链式命令(如 &&)。返回标准输出和标准错误。",
    schema: z.object({
      command: z.string().describe("要执行的 shell 命令，支持 && 等链式语法"),
    }),
    async run({ command }, ctx) {
      const outcome = await runShell(command, workDir, ctx.signal);
      const text = render(outcome);

      // 非零退出码 / 超时都算工具失败：registry 会标 isError，
      // 模型才会走"救援指南"，而不是把错误当正常输出读过去。
      if (outcome.exitCode !== 0 || outcome.timedOut) {
        throw new Error(text);
      }
      return text;
    },
  });
