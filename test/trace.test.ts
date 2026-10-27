import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Span, exportTrace } from "../src/observability/trace.ts";

describe("链路追踪", () => {
  test("父子关系与属性", () => {
    const root = new Span("Agent.Run").addAttribute("SessionID", "s1");
    const turn = new Span("Turn-1", root);
    const tool = new Span("Tool.bash", turn).addAttribute("is_error", false);

    tool.end();
    turn.end();
    root.end();

    const json = root.toJSON();
    expect(json.name).toBe("Agent.Run");
    expect(json.attributes.SessionID).toBe("s1");
    expect(json.children).toHaveLength(1);
    expect(json.children[0]?.name).toBe("Turn-1");
    expect(json.children[0]?.children[0]?.name).toBe("Tool.bash");
    expect(json.children[0]?.children[0]?.attributes.is_error).toBe(false);
    expect(json.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("导出到 .claw/traces 且是合法 JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tsbot-trace-"));
    const root = new Span("Agent.Run");
    new Span("Turn-1", root).end();
    root.end();

    const file = await exportTrace(root, dir, "sess_1");
    const content = JSON.parse(await readFile(file, "utf8")) as { name: string };

    expect(file.replaceAll("\\", "/")).toContain(".claw/traces/trace_sess_1_");
    expect(content.name).toBe("Agent.Run");
  });
});
