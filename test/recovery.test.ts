import { describe, expect, test } from "bun:test";
import { RecoveryManager } from "../src/context/recovery";

const recovery = new RecoveryManager();

describe("RecoveryManager", () => {
  test("edit_file 找不到片段时提示先读文件", () => {
    const out = recovery.analyzeAndInject("edit_file", "在文件中未找到 old_text，请检查内容和缩进");
    expect(out).toContain("[系统救援指南]");
    expect(out).toContain("read_file");
  });

  test("ENOENT 提示先 ls 再猜", () => {
    const out = recovery.analyzeAndInject("read_file", "ENOENT: no such file or directory, open 'a.txt'");
    expect(out).toContain("ls");
  });

  test("bash 找不到命令时给出替代思路", () => {
    const out = recovery.analyzeAndInject("bash", "'rg' is not recognized as an internal or external command");
    expect(out).toContain("等价命令");
  });

  test("未命中特征时原样返回，不污染错误", () => {
    const raw = "some unknown failure";
    expect(recovery.analyzeAndInject("bash", raw)).toBe(raw);
  });

  test("工具与特征不匹配时不乱给建议", () => {
    const raw = "ENOENT: no such file or directory";
    expect(recovery.analyzeAndInject("bash", raw)).toBe(raw);
  });
});
