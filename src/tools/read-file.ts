/**
 * ch05：第一个真工具——只读文件。
 *
 * 注意 description 是写给模型看的说明书，不是给人类看的注释。
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { resolveInside } from "./paths.ts";
import type { Tool } from "./tool.ts";

const schema = z.object({
  path: z.string().describe("要读取的文件路径（相对工作区），如 src/bin/claw.ts"),
});

const MAX_BYTES = 8000;

export class ReadFileTool implements Tool<typeof schema> {
  readonly name = "read_file";
  readonly description =
    "读取指定路径的文件内容。请提供相对工作区的路径。超过 8000 字节会被截断。";
  readonly schema = schema;

  constructor(private readonly workDir: string) {}

  async execute(args: z.infer<typeof schema>): Promise<string> {
    const fullPath = resolveInside(this.workDir, args.path);
    const buffer = await readFile(fullPath).catch((error: Error) => {
      throw new Error(`打开文件失败: ${error.message}`);
    });

    if (buffer.byteLength <= MAX_BYTES) return buffer.toString("utf8");
    return `${buffer.subarray(0, MAX_BYTES).toString("utf8")}\n\n...[由于内容过长，已被系统截断至前 ${MAX_BYTES} 字节]...`;
  }
}
