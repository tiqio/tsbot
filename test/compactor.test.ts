import { describe, expect, test } from "bun:test";
import { Compactor } from "../src/context/compactor.ts";
import type { Message } from "../src/schema/message.ts";

const longText = (n: number) => "x".repeat(n);

describe("Compactor", () => {
  test("未超阈值时原样返回（同一个数组，零成本）", () => {
    const messages: Message[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ];
    const compactor = new Compactor(10_000, 2);
    expect(compactor.compact(messages)).toBe(messages);
  });

  test("超阈值时早期的长工具输出被压成占位符", () => {
    const messages: Message[] = [
      { role: "system", content: "sys" },
      { role: "user", content: longText(500), toolCallId: "c1" },
      { role: "assistant", content: "ok" },
    ];
    const compactor = new Compactor(100, 1); // 只保护最后 1 条
    const out = compactor.compact(messages);

    expect(out[1]?.content).toContain("早期");
    expect(out[1]?.content).toContain("500");
    expect(out[1]?.toolCallId).toBe("c1"); // 协议字段必须保留
  });

  test("近窗口内的超长工具输出掐头留尾", () => {
    const messages: Message[] = [
      { role: "system", content: "sys" },
      { role: "user", content: `${longText(1200)}TAIL`, toolCallId: "c1" },
    ];
    const compactor = new Compactor(100, 1);
    const out = compactor.compact(messages);

    expect(out[1]?.content.startsWith("x".repeat(500))).toBe(true);
    expect(out[1]?.content.endsWith("TAIL")).toBe(true);
    expect(out[1]?.content).toContain("已被系统截断");
  });

  test("系统提示永远不压缩", () => {
    const messages: Message[] = [{ role: "system", content: longText(1000) }];
    const compactor = new Compactor(10, 0);
    expect(compactor.compact(messages)[0]?.content).toBe(longText(1000));
  });
});
