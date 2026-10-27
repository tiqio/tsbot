/**
 * ch07：局部替换工具 + 四级模糊匹配。
 *
 * 模型给的 old_text 经常和文件里差一个缩进、或者行尾是 CRLF。
 * 这四级匹配就是替模型的"手抖"兜底：
 *   L1 精确 → L2 换行归一 → L3 整体 trim → L4 逐行去缩进
 *
 * 与 Go 版的一个差异：Go 的 L2 直接返回被归一化的全文，
 * 等于把整个文件的 CRLF 悄悄改成 LF；这里记住原文件的换行风格，改完再还原。
 */
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { resolveInside } from "./paths.ts";
import type { Tool } from "./tool.ts";

const schema = z.object({
  path: z.string().describe("要修改的文件路径（相对工作区）"),
  old_text: z
    .string()
    .describe("文件中原有的文本。必须包含足够的上下文，以确保在文件中的唯一性。"),
  new_text: z.string().describe("要替换成的新文本"),
});

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  return haystack.split(needle).length - 1;
}

/** 纯函数，方便单测；失败抛错，错误文案会被回灌给模型 */
export function fuzzyReplace(content: string, oldText: string, newText: string): string {
  // L1：精确匹配
  const exact = countOccurrences(content, oldText);
  if (exact === 1) return content.replace(oldText, newText);
  if (exact > 1) {
    throw new Error(`old_text 匹配到了 ${exact} 处，请提供更多的上下文代码以确保唯一性`);
  }

  // L2 / L3 / L4 都在归一化后的文本上做匹配
  const usesCrlf = content.includes("\r\n");
  const normalizedContent = content.replaceAll("\r\n", "\n");
  const normalizedOld = oldText.replaceAll("\r\n", "\n");

  let replaced: string | undefined;

  const normalizedCount = countOccurrences(normalizedContent, normalizedOld);
  if (normalizedCount === 1) {
    replaced = normalizedContent.replace(normalizedOld, newText);
  }

  // L3：整体 trim 后匹配
  if (replaced === undefined) {
    const trimmedOld = normalizedOld.trim();
    if (trimmedOld !== "" && countOccurrences(normalizedContent, trimmedOld) === 1) {
      replaced = normalizedContent.replace(trimmedOld, newText);
    }
  }

  // L4：逐行去缩进匹配
  if (replaced === undefined) {
    replaced = lineByLineReplace(normalizedContent, normalizedOld, newText);
  }

  return usesCrlf ? replaced.replaceAll("\n", "\r\n") : replaced;
}

function lineByLineReplace(content: string, oldText: string, newText: string): string {
  const contentLines = content.split("\n");
  const oldLines = oldText.trim().split("\n").map((line) => line.trim());

  if (oldLines.length === 0 || contentLines.length < oldLines.length) {
    throw new Error("找不到该代码片段");
  }

  let matchCount = 0;
  let matchStart = -1;

  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    let matched = true;
    for (let j = 0; j < oldLines.length; j++) {
      if ((contentLines[i + j] ?? "").trim() !== oldLines[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      matchCount++;
      matchStart = i;
    }
  }

  if (matchCount === 0) throw new Error("在文件中未找到 old_text，请检查内容和缩进");
  if (matchCount > 1) {
    throw new Error(`模糊匹配到了 ${matchCount} 处代码，请提供更多上下文以定位`);
  }

  const before = contentLines.slice(0, matchStart);
  const after = contentLines.slice(matchStart + oldLines.length);
  return [...before, newText, ...after].join("\n");
}

export class EditFileTool implements Tool<typeof schema> {
  readonly name = "edit_file";
  readonly description =
    "对现有文件进行局部的字符串替换。这比重写整个文件更安全、更快速。请提供足够的 old_text 上下文以确保匹配的唯一性。";
  readonly schema = schema;

  constructor(private readonly workDir: string) {}

  async execute(args: z.infer<typeof schema>): Promise<string> {
    const fullPath = resolveInside(this.workDir, args.path);
    const original = await readFile(fullPath, "utf8").catch((error: Error) => {
      throw new Error(`读取文件失败，请确认路径是否正确: ${error.message}`);
    });

    const updated = fuzzyReplace(original, args.old_text, args.new_text);
    await writeFile(fullPath, updated, "utf8");
    return `✅ 成功修改文件: ${args.path}`;
  }
}
