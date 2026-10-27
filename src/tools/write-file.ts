/**
 * ch06：写文件。目录不存在就建，路径必须在工作区内。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { resolveInside } from "./paths.ts";
import type { Tool } from "./tool.ts";

const schema = z.object({
  path: z.string().describe("要写入的文件路径（相对工作区），如 src/main.ts"),
  content: z.string().describe("要写入的完整文件内容"),
});

export class WriteFileTool implements Tool<typeof schema> {
  readonly name = "write_file";
  readonly description =
    "创建或覆盖写入一个文件。如果目录不存在会自动创建。请提供相对于工作区的相对路径。";
  readonly schema = schema;

  constructor(private readonly workDir: string) {}

  async execute(args: z.infer<typeof schema>): Promise<string> {
    const fullPath = resolveInside(this.workDir, args.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, args.content, "utf8");
    return `成功将内容写入到文件: ${args.path}`;
  }
}
