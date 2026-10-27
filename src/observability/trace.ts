/**
 * ch19：链路追踪。
 *
 * Go 版把 Span 塞进 context.Context 让子函数"顺手"取父节点；
 * TS 里没有等价物，硬要用就得上 AsyncLocalStorage。这里选择显式传父节点：
 *
 *   const turn = new Span("Turn-1", root)
 *   new Span("LLM.Action", turn)
 *
 * 好处是依赖关系一眼可见，坏处是每个打点都要拿到父节点。
 * 代价换来的是：不存在"defer 写在 for 里，span 到函数返回才关"这类隐蔽 bug。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SpanJson {
  name: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  attributes: Record<string, unknown>;
  children: SpanJson[];
}

export class Span {
  private readonly startedAt = Date.now();
  private endedAt = 0;
  private readonly attributes: Record<string, unknown> = {};
  private readonly children: Span[] = [];

  constructor(
    readonly name: string,
    parent?: Span,
  ) {
    parent?.children.push(this);
  }

  addAttribute(key: string, value: unknown): this {
    this.attributes[key] = value;
    return this;
  }

  end(): this {
    this.endedAt = Date.now();
    return this;
  }

  get durationMs(): number {
    return (this.endedAt || Date.now()) - this.startedAt;
  }

  get childSpans(): readonly Span[] {
    return this.children;
  }

  toJSON(): SpanJson {
    return {
      name: this.name,
      startTime: new Date(this.startedAt).toISOString(),
      endTime: this.endedAt ? new Date(this.endedAt).toISOString() : "",
      durationMs: this.durationMs,
      attributes: this.attributes,
      children: this.children.map((child) => child.toJSON()),
    };
  }
}

/** 把根 Span 落盘到 <workDir>/.claw/traces/ 下，返回文件路径 */
export async function exportTrace(
  root: Span,
  workDir: string,
  sessionId: string,
): Promise<string> {
  const traceDir = join(workDir, ".claw", "traces");
  await mkdir(traceDir, { recursive: true });

  const fileName = `trace_${sessionId}_${Date.now()}.json`;
  const filePath = join(traceDir, fileName);
  await writeFile(filePath, JSON.stringify(root.toJSON(), null, 2), "utf8");
  return filePath;
}
