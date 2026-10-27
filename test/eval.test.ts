import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BenchmarkRunner } from "../src/eval/benchmark";
import { ScriptedProvider } from "../src/provider/mock";

const setupConfig = `node -e "require('fs').writeFileSync('config.json', JSON.stringify({name:'tsbot',version:'v1.0.0'},null,2))"`;
const validateConfig = `node -e "process.exit(require('./config.json').version==='v2.0.0'?0:1)"`;

describe("跑分框架", () => {
  test("Agent 正确改写文件时判卷通过", async () => {
    const sandboxRoot = await mkdtemp(join(tmpdir(), "tsbot-bench-"));

    const provider = new ScriptedProvider([
      {
        role: "assistant",
        content: "改版本号",
        toolCalls: [
          {
            id: "c1",
            name: "edit_file",
            arguments: {
              path: "config.json",
              old_text: '"version": "v1.0.0"',
              new_text: '"version": "v2.0.0"',
            },
          },
        ],
      },
      { role: "assistant", content: "改好了" },
    ]);

    const runner = new BenchmarkRunner({
      modelName: "glm-4.5-air",
      createProvider: () => provider,
      sandboxRoot,
    });

    const [result] = await runner.runSuite([
      {
        id: "case_ok",
        name: "改版本号",
        setupScript: setupConfig,
        taskPrompt: "把 config.json 的 version 改成 v2.0.0",
        validateScript: validateConfig,
        maxTurns: 4,
      },
    ]);

    expect(result?.passed).toBe(true);
    expect(result?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("Agent 什么都没干时判卷失败", async () => {
    const sandboxRoot = await mkdtemp(join(tmpdir(), "tsbot-bench-"));

    const runner = new BenchmarkRunner({
      modelName: "glm-4.5-air",
      createProvider: () => new ScriptedProvider([{ role: "assistant", content: "我改好了（其实没改）" }]),
      sandboxRoot,
    });

    const [result] = await runner.runSuite([
      {
        id: "case_fail",
        name: "偷懒",
        setupScript: setupConfig,
        taskPrompt: "把 version 改成 v2.0.0",
        validateScript: validateConfig,
      },
    ]);

    expect(result?.passed).toBe(false);
    expect(result?.error).toContain("判卷脚本失败");
  });

  test("setup 失败时直接判失败，不启动引擎", async () => {
    const sandboxRoot = await mkdtemp(join(tmpdir(), "tsbot-bench-"));

    const runner = new BenchmarkRunner({
      modelName: "glm-4.5-air",
      createProvider: () => new ScriptedProvider([]),
      sandboxRoot,
    });

    const [result] = await runner.runSuite([
      {
        id: "case_setup_fail",
        name: "靶机坏了",
        setupScript: "exit 7",
        taskPrompt: "随便",
        validateScript: "exit 0",
      },
    ]);

    expect(result?.passed).toBe(false);
    expect(result?.error).toContain("靶机 Setup 失败");
  });
});
