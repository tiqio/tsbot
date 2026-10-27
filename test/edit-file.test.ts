import { describe, expect, test } from "bun:test";
import { fuzzyReplace } from "../src/tools/edit-file";

describe("fuzzyReplace 四级匹配", () => {
  test("L1 精确匹配且唯一", () => {
    const out = fuzzyReplace("a\nb\nc\n", "b", "B");
    expect(out).toBe("a\nB\nc\n");
  });

  test("L1 多处命中时要求更多上下文", () => {
    expect(() => fuzzyReplace("x\nx\n", "x", "y")).toThrow("匹配到了 2 处");
  });

  test("L2 忽略 CRLF 差异，且保留原文件的 CRLF 风格", () => {
    const content = "line1\r\nline2\r\nline3\r\n";
    const out = fuzzyReplace(content, "line2\n", "LINE2\n");
    expect(out).toBe("line1\r\nLINE2\r\nline3\r\n");
  });

  test("L3 整体缩进不同也能命中（保留原行首空白）", () => {
    const content = "func a() {\n\tx := 1\n}\n";
    const out = fuzzyReplace(content, "  x := 1", "x := 42");
    expect(out).toBe("func a() {\n\tx := 42\n}\n");
  });

  test("L4 逐行去缩进匹配", () => {
    const content = "func main() {\n    print(1)\n    print(2)\n}\n";
    const out = fuzzyReplace(content, "print(1)\nprint(2)", "print(42)");
    expect(out).toBe("func main() {\nprint(42)\n}\n");
  });

  test("完全找不到时报错，错误文案可被模型读懂", () => {
    expect(() => fuzzyReplace("abc\n", "zzz", "y")).toThrow("未找到 old_text");
  });
});
