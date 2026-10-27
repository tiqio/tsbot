import { describe, expect, test } from "bun:test";
import { Session, SessionManager } from "../src/context/session.ts";
import type { Message } from "../src/schema/message.ts";

function user(content: string, toolCallId?: string): Message {
  return toolCallId ? { role: "user", content, toolCallId } : { role: "user", content };
}

describe("Session", () => {
  test("工作记忆只取最近 N 条", () => {
    const session = new Session("s1", "/tmp");
    for (let i = 0; i < 30; i++) session.append(user(`m${i}`));

    const memory = session.getWorkingMemory(5);
    expect(memory).toHaveLength(5);
    expect(memory[0]?.content).toBe("m25");
    expect(memory[4]?.content).toBe("m29");
  });

  test("截断后开头是孤儿 tool_result 时自动剥掉", () => {
    const session = new Session("s1", "/tmp");
    session.append({ role: "assistant", content: "调用工具" });
    session.append(user("结果 A", "call_1"));
    session.append(user("结果 B", "call_2"));
    session.append({ role: "assistant", content: "继续" });

    // 只留 3 条：会以 tool_result 开头，必须被剥掉
    const memory = session.getWorkingMemory(3);
    expect(memory[0]?.toolCallId).toBeUndefined();
    expect(memory.every((m) => !(m.role === "user" && m.toolCallId))).toBe(true);
  });

  test("limit 大于历史长度时返回全量副本，不影响原数组", () => {
    const session = new Session("s1", "/tmp");
    session.append(user("only"));
    const memory = session.getWorkingMemory(10);
    memory.push(user("外部篡改"));
    expect(session.length).toBe(1);
  });

  test("累计用量与花费", () => {
    const session = new Session("s1", "/tmp");
    session.recordUsage({ promptTokens: 100, completionTokens: 20 }, 0.001);
    session.recordUsage({ promptTokens: 50, completionTokens: 10 }, 0.0005);
    expect(session.totals.promptTokens).toBe(150);
    expect(session.totals.completionTokens).toBe(30);
    expect(session.totals.costCNY).toBeCloseTo(0.0015, 6);
  });
});

describe("SessionManager", () => {
  test("同一 id 复用同一会话", () => {
    const manager = new SessionManager();
    const a = manager.getOrCreate("chat_1", "/tmp");
    const b = manager.getOrCreate("chat_1", "/tmp");
    expect(a).toBe(b);
    expect(manager.size).toBe(1);
  });
});
