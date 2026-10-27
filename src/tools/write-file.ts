import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { resolveInside } from "./paths";
import { defineTool } from "./tool";

export const writeFileTool = (workDir: string) =>
  defineTool({
    name: "write_file",
    description:
      "创建或覆盖写入一个文件。如果目录不存在会自动创建。请提供相对于工作区的相对路径。",
    schema: z.object({
      path: z.string().describe("要写入的文件路径（相对工作区），如 src/main.ts"),
      content: z.string().describe("要写入的完整文件内容"),
    }),
    async run({ path, content }) {
      const fullPath = resolveInside(workDir, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf8");
      return `成功将内容写入到文件: ${path}`;
    },
  });
