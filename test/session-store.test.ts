import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../src/context/session";
import {
  loadSession,
  safeSessionName,
  saveSession,
  sessionFile,
} from "../src/context/session-store";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tsbot-session-"));
}

describe("会话快照", () => {
  test("导出再恢复，历史与账单都还在", () => {
    const session = new Session("s1", "/tmp");
    session.append({ role: "user", content: "第一句" });
    session.append({ role: "assistant", content: "第一答" });
    session.recordUsage({ promptTokens: 100, completionTokens: 20 }, 0.001);

    const restored = Session.restore(session.toSnapshot());
    expect(restored.id).toBe("s1");
    expect(restored.length).toBe(2);
    expect(restored.all[0]?.content).toBe("第一句");
    expect(restored.totals).toEqual({ promptTokens: 100, completionTokens: 20, costCNY: 0.001 });
  });

  test("快照里没有运行时对象，可以安全 JSON 化", () => {
    const session = new Session("s2", "/tmp");
    session.append({ role: "user", content: "hi" });
    const json = JSON.parse(JSON.stringify(session.toSnapshot())) as { history: unknown[] };
    expect(json.history).toHaveLength(1);
  });
});

describe("会话持久化", () => {
  test("save 之后 load 能拿回同样的内容", async () => {
    const dir = await tempDir();
    const session = new Session("t1", dir);
    session.append({ role: "user", content: "把版本号改成 v2" });

    const file = await saveSession(session);
    expect(file.replaceAll("\\", "/")).toContain(".claw/sessions/t1.json");

    const restored = await loadSession(dir, "t1");
    expect(restored?.length).toBe(1);
    expect(restored?.all[0]?.content).toBe("把版本号改成 v2");
  });

  test("没有文件时返回 undefined，不抛异常", async () => {
    const dir = await tempDir();
    expect(await loadSession(dir, "不存在")).toBeUndefined();
  });

  test("文件被写坏时也当成新会话", async () => {
    const dir = await tempDir();
    const file = sessionFile(dir, "bad");
    await saveSession(new Session("bad", dir));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "{ 不是 JSON", "utf8");

    expect(await loadSession(dir, "bad")).toBeUndefined();
  });

  test("session id 里的路径字符会被清掉", async () => {
    const dir = await tempDir();
    const session = new Session("../../etc/passwd", dir);
    const file = await saveSession(session);

    expect(safeSessionName("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(file.replaceAll("\\", "/")).toContain(".claw/sessions/.._.._etc_passwd.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ id: "../../etc/passwd" });
  });
});
