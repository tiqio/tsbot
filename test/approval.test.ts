import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ApprovalManager, isDangerousCommand } from "../src/feishu/approval";
import { createRegistry } from "../src/tools/registry";
import { defineTool } from "../src/tools/tool";

describe("高危动作判定", () => {
  const cases: Array<[string, string, boolean]> = [
    ["read_file", '{"path":"a.txt"}', false],
    ["write_file", '{"path":"a.txt"}', true],
    ["edit_file", '{"path":"a.txt"}', true],
    ["bash", '{"command":"ls -la"}', false],
    ["bash", '{"command":"rm -rf /tmp/x"}', true],
    ["bash", '{"command":"nginx -s reload"}', true],
    ["bash", '{"command":"systemctl restart nginx"}', true],
    ["bash", '{"command":"del /s /q build"}', true],
    ["bash", '{"command":"taskkill /im node.exe"}', true],
  ];

  for (const [tool, args, expected] of cases) {
    test(`${tool} ${args} → ${expected}`, () => {
      expect(isDangerousCommand(tool, args)).toBe(expected);
    });
  }
});

describe("ApprovalManager", () => {
  test("挂起后由 approve 唤醒", async () => {
    const manager = new ApprovalManager();
    const notices: string[] = [];

    const promise = manager.waitForApproval("task_1", "bash", "rm -rf x", (text) =>
      notices.push(text),
    );

    expect(notices[0]).toContain("approve task_1");
    expect(manager.pendingCount).toBe(1);

    expect(manager.resolveApproval("task_1", true, "批准")).toBe(true);
    await expect(promise).resolves.toEqual({ allowed: true, reason: "批准" });
    expect(manager.pendingCount).toBe(0);
  });

  test("重复 resolve 返回 false，不会重复唤醒", () => {
    const manager = new ApprovalManager();
    void manager.waitForApproval("task_2", "bash", "", () => {});
    expect(manager.resolveApproval("task_2", false, "拒绝")).toBe(true);
    expect(manager.resolveApproval("task_2", false, "拒绝")).toBe(false);
  });
});

describe("中间件拦截链", () => {
  test("拒绝时返回 isError 与拒绝理由，工具本体不会被调用", async () => {
    const registry = createRegistry();
    let executed = false;

    registry.register(
      defineTool({
        name: "danger",
        description: "危险工具",
        schema: z.object({}),
        async run() {
          executed = true;
          return "done";
        },
      }),
    );

    registry.use((call) =>
      call.name === "danger"
        ? { allowed: false, reason: "需要人工审批" }
        : { allowed: true },
    );

    const blocked = await registry.execute({ id: "c1", name: "danger", arguments: {} });
    expect(blocked.isError).toBe(true);
    expect(blocked.output).toContain("需要人工审批");
    expect(executed).toBe(false);
  });

  test("多个中间件按挂载顺序执行，任一拒绝即终止", async () => {
    const registry = createRegistry();
    const order: string[] = [];

    registry.register(
      defineTool({
        name: "ok",
        description: "普通工具",
        schema: z.object({}),
        async run() {
          return "done";
        },
      }),
    );

    registry.use(() => {
      order.push("first");
      return { allowed: true };
    });
    registry.use(() => {
      order.push("second");
      return { allowed: false, reason: "止损" };
    });
    registry.use(() => {
      order.push("third");
      return { allowed: true };
    });

    const result = await registry.execute({ id: "c1", name: "ok", arguments: {} });
    expect(result.isError).toBe(true);
    expect(order).toEqual(["first", "second"]);
  });
});
