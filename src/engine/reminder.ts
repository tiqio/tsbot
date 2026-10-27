/**
 * ch15：死循环探测。
 *
 * 模型卡住时的典型症状：用完全相同的参数、反复调用同一个工具、每次都失败。
 * 这里用 (工具名 + 参数) 的指纹计数，连续三次就注入一条"停下来换策略"的系统提醒。
 *
 * 注意：成功一次就清空计数，避免把"改对了再试一次"误判成死循环。
 */
import { createHash } from "node:crypto";
import type { Message, ToolCall, ToolResult } from "../schema/message";

const MAX_CONSECUTIVE_FAILURES = 3;

function fingerprint(call: ToolCall): string {
  return createHash("md5")
    .update(call.name)
    .update(JSON.stringify(call.arguments ?? {}))
    .digest("hex");
}

export class ReminderInjector {
  private readonly failures = new Map<string, number>();

  checkAndInject(call: ToolCall, result: ToolResult): Message | undefined {
    if (!result.isError) {
      this.failures.clear();
      return undefined;
    }

    const key = fingerprint(call);
    const count = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, count);

    console.log(
      `[Reminder] 监控到工具 ${call.name} 执行失败，该参数特征连续失败次数: ${count}`,
    );

    if (count < MAX_CONSECUTIVE_FAILURES) return undefined;

    console.log("[Reminder] ⚠️ 触发死循环干预！注入强力修正指令。");

    return {
      role: "user",
      content: `[SYSTEM REMINDER 警告]
你似乎陷入了死循环：刚刚连续 ${count} 次用相同参数调用了 '${call.name}' 工具，并且全部失败。
请立即停止这种无效重试，你的注意力被当前报错过度吸引了。
你需要：
1. 停止猜测参数，跳出当前的局部思维。
2. 彻底改变策略（换工具、换路径、换思路）。
3. 如果确实无法用现有工具解决，请直接结束任务并说明你需要什么人工帮助，而不是继续盲目消耗 API 资源。`,
    };
  }

  /** 供测试与调试观察内部状态 */
  get failureCount(): number {
    return this.failures.size;
  }
}
