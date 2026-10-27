/**
 * ch20：自动化跑分。
 *
 * 一个用例 = 靶机初始化脚本 + 任务指令 + 判卷脚本。
 * 关键是"物理隔离"：每个用例一个全新的沙箱目录，
 * 跑完用真实命令验收（exit 0 即通过），而不是让模型自己说"我完成了"。
 *
 * 与 Go 版的差异：
 * - Go 的 TestCase.MaxTurns 字段根本没被使用（死字段），这里真的按轮数封顶；
 * - 沙箱目录、setup、判卷全部复用 bash.ts 的 runShell，行为与 Agent 自己执行的命令一致。
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Session } from "../context/session.ts";
import { AgentEngine } from "../engine/loop.ts";
import { silentReporter } from "../engine/reporter.ts";
import { CostTracker } from "../observability/tracker.ts";
import type { LLMProvider } from "../provider/types.ts";
import { createTools } from "../tools/index.ts";
import { runShell } from "../tools/bash.ts";
import { ToolRegistry } from "../tools/registry.ts";

export interface TestCase {
  id: string;
  name: string;
  /** 可选：Agent 开始前执行的脚本，用来准备靶机代码 */
  setupScript?: string;
  /** 发给 Agent 的任务指令 */
  taskPrompt: string;
  /** 判卷脚本：exit 0 视为通过 */
  validateScript: string;
  /** 允许的最大轮数 */
  maxTurns?: number;
}

export interface TestResult {
  testCaseId: string;
  passed: boolean;
  costCNY: number;
  durationMs: number;
  error?: string;
}

export interface BenchmarkOptions {
  modelName: string;
  /** 每个用例都新建一个 provider，避免会话之间串味 */
  createProvider: () => LLMProvider;
  /** 沙箱根目录，默认 ./workspace */
  sandboxRoot?: string;
  maxTurnsDefault?: number;
}

export class BenchmarkRunner {
  private readonly sandboxRoot: string;

  constructor(private readonly options: BenchmarkOptions) {
    this.sandboxRoot = options.sandboxRoot ?? join(process.cwd(), "workspace");
  }

  async runSuite(cases: TestCase[]): Promise<TestResult[]> {
    console.log("==================================================");
    console.log(`🚀 启动 Harness Benchmark | 模型: ${this.options.modelName}`);
    console.log(`📦 用例数: ${cases.length}`);
    console.log("==================================================");

    const results: TestResult[] = [];

    for (const testCase of cases) {
      console.log(`\n>>> ⏳ 执行用例 [${testCase.id}]: ${testCase.name}`);
      const result = await this.runOne(testCase);
      results.push(result);

      const icon = result.passed ? "✅" : "❌";
      console.log(
        `>>> ${icon} [${testCase.id}] ${result.passed ? "通过" : "失败"} | ${result.durationMs}ms | ¥${result.costCNY.toFixed(6)}`,
      );
      if (!result.passed) console.log(`    原因: ${result.error ?? "未知"}`);
    }

    const passed = results.filter((item) => item.passed).length;
    const rate = cases.length === 0 ? 0 : (passed / cases.length) * 100;
    const totalCost = results.reduce((sum, item) => sum + item.costCNY, 0);

    console.log("\n================ 🏆 跑分报告 ================");
    console.log(`总用例: ${cases.length} | 通过: ${passed} | 通过率: ${rate.toFixed(1)}%`);
    console.log(`总成本: ¥${totalCost.toFixed(6)}`);
    console.log("=============================================");

    return results;
  }

  async runOne(testCase: TestCase): Promise<TestResult> {
    const startedAt = Date.now();
    const sandbox = join(this.sandboxRoot, `${testCase.id}_${Date.now()}`);
    await mkdir(sandbox, { recursive: true });

    // 1. 准备靶机
    if (testCase.setupScript) {
      const setup = await runShell(testCase.setupScript, sandbox);
      if (setup.exitCode !== 0) {
        return {
          testCaseId: testCase.id,
          passed: false,
          costCNY: 0,
          durationMs: Date.now() - startedAt,
          error: `靶机 Setup 失败: ${setup.stdout}${setup.stderr}`,
        };
      }
    }

    // 2. 组装带计费的引擎
    const session = new Session(testCase.id, sandbox);
    session.append({ role: "user", content: testCase.taskPrompt });

    const registry = new ToolRegistry();
    for (const tool of createTools(sandbox)) registry.register(tool);

    const provider = new CostTracker(
      this.options.createProvider(),
      this.options.modelName,
      session,
    );
    const engine = new AgentEngine(provider, registry, {
      maxTurns: testCase.maxTurns ?? this.options.maxTurnsDefault ?? 15,
    });

    // 3. 让它干活（静音 reporter，避免刷屏）
    try {
      await engine.run(session, { reporter: silentReporter });
    } catch (error) {
      return {
        testCaseId: testCase.id,
        passed: false,
        costCNY: session.totals.costCNY,
        durationMs: Date.now() - startedAt,
        error: `Agent 崩溃: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // 4. 判卷：真实执行，不看模型自述
    const verdict = await runShell(testCase.validateScript, sandbox);

    return {
      testCaseId: testCase.id,
      passed: verdict.exitCode === 0,
      costCNY: session.totals.costCNY,
      durationMs: Date.now() - startedAt,
      error:
        verdict.exitCode === 0
          ? undefined
          : `判卷脚本失败(exit ${verdict.exitCode}): ${(verdict.stdout + verdict.stderr).slice(0, 500)}`,
    };
  }
}
