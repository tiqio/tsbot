import { describe, expect, test } from "bun:test";
import { ReminderInjector } from "../src/engine/reminder.ts";
import type { ToolCall, ToolResult } from "../src/schema/message.ts";

const failingCall: ToolCall = {
  id: "c1",
  name: "read_file",
  arguments: { path: "不存在.txt" },
};

const failResult: ToolResult = {
  toolCallId: "c1",
  output: "ENOENT: no such file or directory",
  isError: true,
};

describe("ReminderInjector", () => {
  test("前两次失败保持沉默", () => {
    const injector = new ReminderInjector();
    expect(injector.checkAndInject(failingCall, failResult)).toBeUndefined();
    expect(injector.checkAndInject(failingCall, failResult)).toBeUndefined();
  });

  test("连续三次相同参数失败后注入警告", () => {
    const injector = new ReminderInjector();
    injector.checkAndInject(failingCall, failResult);
    injector.checkAndInject(failingCall, failResult);
    const reminder = injector.checkAndInject(failingCall, failResult);

    expect(reminder?.role).toBe("user");
    expect(reminder?.content).toContain("死循环");
    expect(reminder?.content).toContain("read_file");
  });

  test("参数不同则各自计数，互不干扰", () => {
    const injector = new ReminderInjector();
    injector.checkAndInject(failingCall, failResult);
    injector.checkAndInject(failingCall, failResult);
    const other = injector.checkAndInject(
      { ...failingCall, id: "c2", arguments: { path: "另一个.txt" } },
      failResult,
    );
    expect(other).toBeUndefined();
  });

  test("成功一次就清空计数", () => {
    const injector = new ReminderInjector();
    injector.checkAndInject(failingCall, failResult);
    injector.checkAndInject(failingCall, failResult);
    injector.checkAndInject(failingCall, { ...failResult, isError: false, output: "ok" });
    expect(injector.failureCount).toBe(0);

    const reminder = injector.checkAndInject(failingCall, failResult);
    expect(reminder).toBeUndefined();
  });
});
