/**
 * 会话持久化：`<workDir>/.claw/sessions/<id>.json`。
 *
 * 原书的 Session 只在内存里，`-session` 参数因此没什么用。这里补上落盘，
 * 让「同一个 session 跑第二次」真的能接着上次的上下文。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Session, type SessionSnapshot } from "./session";

/** session id 会进文件名，必须清掉路径分隔符之类的字符 */
export function safeSessionName(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
}

export function sessionFile(workDir: string, id: string): string {
  return join(workDir, ".claw", "sessions", `${safeSessionName(id)}.json`);
}

export async function saveSession(session: Session): Promise<string> {
  const file = sessionFile(session.workDir, session.id);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(session.toSnapshot(), null, 2), "utf8");
  return file;
}

export async function loadSession(workDir: string, id: string): Promise<Session | undefined> {
  try {
    const raw = await readFile(sessionFile(workDir, id), "utf8");
    return Session.restore(JSON.parse(raw) as SessionSnapshot);
  } catch {
    // 没有文件、JSON 坏了、字段缺失 —— 都当成"新会话"，不打断用户
    return undefined;
  }
}
