import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashTool } from "../src/tools/bash";
import { writeFileTool } from "../src/tools/write-file";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tsbot-"));
}

describe("bash 工具", () => {
  test("返回标准输出", async () => {
    const tool = bashTool(await tempDir());
    expect((await tool.run({ command: "echo tsbot-ok" }, {})).trim()).toBe("tsbot-ok");
  });

  test("非零退出码抛错，由 registry 标成 isError", async () => {
    const tool = bashTool(await tempDir());
    await expect(tool.run({ command: "exit 3" }, {})).rejects.toThrow("退出码 3");
  });

  test("命令在工作区内执行", async () => {
    const dir = await tempDir();
    const tool = bashTool(dir);
    // 用 node 而不是 cat，保证在 Windows(cmd) 与 POSIX(bash) 下都能跑
    const out = await tool.run({ command: 'node -p "process.cwd()"' }, {});
    expect(out.trim().toLowerCase()).toBe(dir.toLowerCase());
  });
});

describe("write_file 工具", () => {
  test("自动创建父目录并写入", async () => {
    const dir = await tempDir();
    const message = await writeFileTool(dir).run(
      { path: "deep/nested/x.txt", content: "内容" },
      {},
    );

    expect(message).toContain("deep/nested/x.txt");
    expect(await readFile(join(dir, "deep/nested/x.txt"), "utf8")).toBe("内容");
  });

  test("拒绝写出工作区", async () => {
    const tool = writeFileTool(await tempDir());
    await expect(tool.run({ path: "../escape.txt", content: "x" }, {})).rejects.toThrow(
      "路径越界",
    );
  });
});
