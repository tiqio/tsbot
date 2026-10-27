/**
 * 工具清单工厂。
 *
 * 三个入口（claw / bench / agentops）注册同一批工具，集中在这里；
 * 加工具只改这一个文件。
 */
import { bashTool } from "./bash";
import { editFileTool } from "./edit-file";
import { readFileTool } from "./read-file";
import type { Tool } from "./tool";
import { writeFileTool } from "./write-file";

export function createTools(workDir: string): Tool[] {
  return [
    readFileTool(workDir),
    writeFileTool(workDir),
    editFileTool(workDir),
    bashTool(workDir),
  ];
}

/** 只读子集，给子智能体用；它物理上拿不到写工具 */
export function createReadOnlyTools(workDir: string): Tool[] {
  return [readFileTool(workDir), bashTool(workDir)];
}
