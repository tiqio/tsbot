# tsbot

`go-tiny-claw`（极客时间专栏《从零构建 Agent Harness》）的 **TypeScript / Bun 移植版**。

原项目用 Go 实现，仓库：<https://github.com/bigwhite/publication/tree/master/column/timegeek/build-agent-harness-from-scratch>

本仓库不是一次性翻译，而是**按章节推进的提交历史**：每个 commit 对应原书的 ch01 ~ ch22，
`git log` 就是这本书的目录，`git diff` 就是每一讲的增量。

## 为什么单独开一个 TS 版

不是为了证明 TS 比 Go 好，而是同一套架构在两种语言下的**对照样本**：

| 维度 | Go 版 | TS 版（本仓库） |
| --- | --- | --- |
| 工具入参 schema | 手写 `map[string]interface{}` + `json.Unmarshal` 到结构体 | zod 一处定义，同时产出运行时校验、JSON Schema、TS 类型 |
| 消息/内容块 | `ContentBlockParamUnion{OfToolUse: ...}` 联合体 | 可辨识联合（discriminated union） |
| 取消与超时 | `context.Context` 层层传递 | `AbortSignal` 显式下发 |
| 并发 | goroutine + `sync.WaitGroup` | `Promise.all` / `Promise.allSettled` |
| 模块私有性 | `internal/` 编译器强制 | 目录约定（靠 code review） |
| 分发 | 静态单文件 | `bun build --compile` 单文件（体积更大） |

## 运行

```bash
bun install

# 离线演示：不调用真实模型，用脚本化 mock 走完整条 ReAct 循环
bun run demo

# 接入真实模型（智谱 GLM 的 Anthropic / OpenAI 兼容端点）
$env:ZHIPU_API_KEY="..."   # PowerShell
bun run claw --prompt "读一下 workspace/nginx.conf，找出 502 的原因"

# 单元测试 / 类型检查
bun test
bun run typecheck
```

## 目录

```
src/
  bin/         claw / agentops / bench 三个入口
  schema/      消息与工具定义（zod）
  provider/    LLM 适配层
  tools/       工具与注册表
  context/     会话、提示词组装、压缩、恢复、技能加载
  engine/      ReAct 主循环
  observability/ 成本与链路追踪
  feishu/      飞书接入与人工审批
  eval/        跑分框架
workspace/     给 Agent 操作的沙箱
```

## 章节 ↔ commit

构建过程中实时维护，见文末对照表（随章节推进追加）。
