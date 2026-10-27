/**
 * ch05：路径闸门。
 *
 * Go 版的工具直接 `filepath.Join(workDir, input.Path)`，
 * 模型只要给出 `../../etc/passwd` 就逃出了工作区。
 * 这里改成"解析后必须仍在工作区内"，越界直接报错给模型看。
 */
import { isAbsolute, relative, resolve } from "node:path";

export function resolveInside(workDir: string, path: string): string {
  const target = resolve(workDir, path);
  const rel = relative(workDir, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`路径越界：${path} 不在工作区 ${workDir} 内`);
  }
  return target;
}
