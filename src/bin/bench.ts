/**
 * ch20：跑分入口。
 *
 *   bun run bench
 *
 * 需要真实模型（每个用例都要重新想一遍怎么做），所以要求 API Key。
 */
import { createProvider, detectProviderKind } from "../provider/factory.ts";
import { BenchmarkRunner } from "../eval/benchmark.ts";
import type { TestCase } from "../eval/benchmark.ts";

const kind = detectProviderKind();
if (kind === "mock") {
  console.error("❌ 跑分需要真实模型：请设置 ANTHROPIC_API_KEY / ZHIPU_API_KEY / OPENAI_API_KEY");
  process.exit(1);
}

const resolved = createProvider(kind);
if (!resolved) {
  console.error(`❌ 无法创建 provider: ${kind}`);
  process.exit(1);
}

const cases: TestCase[] = [
  {
    id: "test_001_edit",
    name: "测试模糊替换工具的准确性",
    setupScript: `node -e "require('fs').writeFileSync('config.json', JSON.stringify({name:'tsbot',version:'v1.0.0'},null,2))"`,
    taskPrompt:
      "当前目录下有一个 config.json。请使用 edit_file 工具，把其中的 version 从 v1.0.0 改成 v2.0.0，不要做其他操作。",
    validateScript: `node -e "process.exit(require('./config.json').version==='v2.0.0'?0:1)"`,
    maxTurns: 6,
  },
  {
    id: "test_002_code_gen",
    name: "读代码 + 写单测的综合能力",
    setupScript: `node -e "require('fs').writeFileSync('greet.js', 'module.exports = (name) => \"hi \" + name;\\n')"`,
    taskPrompt:
      "当前目录下有一个 greet.js。请仔细阅读它，然后在同级目录写出 greet.test.js：用 node:assert 断言 greet('a') === 'hi a'，断言失败时以非零码退出，成功时打印 ALL OK。",
    validateScript: `node greet.test.js`,
    maxTurns: 10,
  },
];

const runner = new BenchmarkRunner({
  modelName: resolved.model,
  createProvider: () => resolved.provider,
  sandboxRoot: `${process.cwd()}/workspace`,
});

await runner.runSuite(cases);
