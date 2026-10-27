import { readFile } from "node:fs/promises";
import { z } from "zod";
import { resolveInside } from "./paths";
import { defineTool } from "./tool";

const MAX_BYTES = 8000;

export const readFileTool = (workDir: string) =>
  defineTool({
    name: "read_file",
    description:
      "读取指定路径的文件内容。请提供相对工作区的路径。超过 8000 字节会被截断。",
    schema: z.object({
      path: z.string().describe("要读取的文件路径（相对工作区），如 src/bin/claw.ts"),
    }),
    async run({ path }) {
      const buffer = await readFile(resolveInside(workDir, path)).catch(
        (error: Error) => {
          throw new Error(`打开文件失败: ${error.message}`);
        },
      );

      if (buffer.byteLength <= MAX_BYTES) return buffer.toString("utf8");
      return `${buffer.subarray(0, MAX_BYTES).toString("utf8")}\n\n...[由于内容过长，已被系统截断至前 ${MAX_BYTES} 字节]...`;
    },
  });
