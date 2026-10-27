/**
 * ch06：工具清单工厂。
 *
 * 三个入口（claw / bench / agentops）都要注册同一批工具，
 * 集中在这里避免每处重复；后续章节加工具只改这一个文件。
 */
import type { Tool } from "./tool.ts";
import { BashTool } from "./bash.ts";
import { EditFileTool } from "./edit-file.ts";
import { ReadFileTool } from "./read-file.ts";
import { WriteFileTool } from "./write-file.ts";

export function createTools(workDir: string): Tool[] {
  return [
    new ReadFileTool(workDir),
    new WriteFileTool(workDir),
    new EditFileTool(workDir),
    new BashTool(workDir),
  ];
}
