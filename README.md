# tsbot

`go-tiny-claw`（极客时间专栏《从零构建 Agent Harness》，作者 Tony Bai）的 **TypeScript / Bun 移植版**。

原项目（Go）：<https://github.com/bigwhite/publication/tree/master/column/timegeek/build-agent-harness-from-scratch>

本仓库不是一次性翻译，而是**按章节推进的提交历史**：每个 commit 对应原书的一讲，
`git log` 就是目录，`git diff ch(N-1)..ch(N)` 就是那一讲的增量。

```bash
bun install
bun run demo        # 离线演示：完整 ReAct + 审批闸门，不需要 API Key
bun test            # 67 个用例
bun run typecheck   # tsc --noEmit，严格模式
```

## 为什么单独开一个 TS 版

不是为了证明 TS 比 Go 好，而是给同一套架构留一个对照样本。四章下来最明显的差别：

| 维度 | Go 版 | TS 版（本仓库） |
| --- | --- | --- |
| 工具入参 schema | `Definition()` 手写 JSON Schema map **+** `Execute()` 里的 args struct，两份真相 | 一份 zod schema，同时产出运行时校验、JSON Schema、`execute` 的参数类型 |
| 消息 / 内容块 | `ContentBlockParamUnion{OfToolUse: …}` 结构体伪装联合体 | 可辨识联合，空 text block 只在真的空时才补 |
| 工具执行 | 同步函数，天然可以在 goroutine 里跑 | `async`，异步会传染到主循环（代价） |
| 并发 | goroutine + WaitGroup，结果要按 `idx` 手工对位 | `Promise.all`，顺序天然与入参一致 |
| 取消 / 超时 | `context.Context` 层层透传 | `AbortSignal`，直接挂到 `fetch` 与子进程 |
| 跨层传值（reporter） | `context.WithValue` | `AsyncLocalStorage` |
| 会话并发 | `sync.RWMutex` | 单线程事件循环，这层锁直接消失 |
| 模块私有性 | `internal/` 编译器强制 | 目录约定（**这是退步**） |
| 分发 | 静态单文件，约 10–15 MB | `bun build --compile` 也能出单文件，实测 **110 MB** |

## 章节 ↔ commit

| 章 | commit | 本仓库对应内容 |
| --- | --- | --- |
| ch01 | `ch01` | `package.json` / `tsconfig` / 入口占位 |
| ch02 | `ch02` | `engine/loop.ts` 最小 ReAct 循环、provider 与 registry 契约、mock |
| ch03 | `ch03` | 思考 / 行动两阶段（Thinking 阶段传空工具列表） |
| ch04 | `ch04` | Anthropic 与 OpenAI 兼容 provider（不引 SDK）、provider 工厂、脚本化 mock |
| ch05 | `ch05` | `read_file`、`ToolRegistry`、zod→JSON Schema、路径闸门 |
| ch06 | `ch06` | `bash`（`shell:true` + AbortSignal）、`write_file` |
| ch07 | `ch07` | `edit_file` 四级模糊匹配 |
| ch08 | `ch08` | 工具并发执行，结果顺序保持 |
| ch09 | `ch09` | `Reporter` 抽象、终端实现、飞书 webhook（`node:http` 手写） |
| ch10 | `ch10` | `PromptComposer`（身份 + 纪律 + AGENTS.md + skills）、SKILL.md 解析 |
| ch11 | `ch11` | `Session` / `SessionManager`、孤儿 tool_result 裁剪 |
| ch12 | `ch12` | 上下文压缩（占位符 / 掐头留尾 / 折叠） |
| ch13 | `ch13` | Plan Mode、协议占位消息 |
| ch14 | `ch14` | 失败救援指南（含 ENOENT/EACCES/Windows 文案） |
| ch15 | `ch15` | 死循环探测（参数指纹三次） |
| ch16 | `ch16` | 工具中间件、审批管理器、`approve/reject` 口令 |
| ch17 | `ch17` | 子智能体 `runSub`（只读、10 轮封顶） |
| ch18 | `ch18` | `CostTracker` 装饰器 + 计费 |
| ch19 | `ch19` | Span 树与 `.claw/traces/*.json` |
| ch20 | `ch20` | 跑分框架（沙箱 + setup + 真判卷）与 `bun run bench` |
| ch21 | `ch21` | CLI 完整化：帮助、Ctrl+C、轮数上限、退出码、账单 |
| ch22 | `ch22` | AgentOps 飞书服务端、审批中间件接 `AsyncLocalStorage`、离线演示、GBK 解码 |

## 目录

```
src/
  bin/            claw / bench / agentops / demo 四个入口
  schema/         message.ts（含 zod 工具定义）
  provider/       types / anthropic / openai / http / factory / mock
  tools/          tool / registry / paths / read-file / write-file / edit-file / bash / subagent
  context/        session / composer / skill / compactor / recovery
  engine/         loop / reminder / reporter / terminal-reporter
  observability/  tracker / trace
  feishu/         bot / approval / context(AsyncLocalStorage)
  eval/           benchmark
workspace/        沙箱：AGENTS.md、skills、nginx.conf、error.log、ports.md
```

## 代码风格（TS 版）

移植完成后的两轮 polish 把它改成了更"TS 原生"的写法，目标是**读的人不需要解码类型**：

1. **工具是对象，不是类**。每个工具文件只写 `name / description / schema / run` 四个字段，
   泛型只出现在 `tools/tool.ts` 的 `defineTool` 一处：

   ```ts
   export const readFileTool = (workDir: string) =>
     defineTool({
       name: "read_file",
       description: "读取指定路径的文件内容。",
       schema: z.object({ path: z.string().describe("相对工作区的路径") }),
       async run({ path }) { … },   // path 已是 string，不用写类型
     });
   ```

2. **注册表只暴露类型和工厂**：`Registry`（接口）+ `createRegistry()`，实现类不导出 ——
   避免 Go 式"interface + struct 两个名字指一件事"的读法成本。

3. **import 不带 `.ts` 扩展名**，靠 `moduleResolution: "bundler"` 解析。

4. **主循环四层**：`run`（根 span / 落盘）→ `runTurns`（轮数）→ `runTurn`（一轮三段）
   → `executeOne`（单个工具）。单屏可读完。

## 与 Go 版的差异（有意为之）

1. **不引模型 SDK**。Go 版用 `anthropic-sdk-go` / `openai-go`，这里用 `fetch` 直连，
   zod 之外零运行时依赖。一本"从零构建"的书，协议本身就该被看见。
2. **路径闸门**。Go 的工具是 `filepath.Join(workDir, path)`，模型给 `../../etc/passwd` 就能越界；
   这里 `resolveInside()` 强制解析结果仍在工作区内。
3. **bash 的非零退出码 / 超时算工具失败**（`isError`），模型才会走救援指南。
4. **Windows 适配**：`shell: true` 交给 Node 选 shell，避开 argv 转义吞引号；
   子进程输出按 UTF-8 严格解码，失败回落 GBK（cmd 的报错是 GBK）。
5. **`maxTurns` 真的生效**。Go 版 `TestCase.MaxTurns` 定义了却没被使用。
6. **修掉两处 Go 版副作用**：`edit_file` 的 L2 匹配会把整个文件 CRLF 改成 LF；`defer` 写在
   `for` 里导致 span 到函数返回才关闭。前者按原换行风格还原，后者改用显式 `end()`。
7. **额外的 `demo` 入口**：脚本化模型 + 真实工具 + 真实审批，离线复现完整排障流程。

## 已知限制

- 飞书只处理明文事件，未实现 `encrypt_key` 解密与签名校验（Go 版由 SDK 代劳），生产必须补。
- Session 只在内存里，进程退出即消失（与原书一致）；`--session` 目前只用于同进程内复用。
- `bench` 需要真实模型，没有 mock 通道——否则跑分就是自欺欺人。
- 没有做 MCP、流式输出、多 provider 重试；这些是"再写一章"的事。
