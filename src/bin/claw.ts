/**
 * ch01：骨架与入口。
 * 与 Go 版 cmd/claw/main.go 对应，此时还没有任何引擎实现，只是一条启动序列。
 */
console.log("🚀 欢迎来到 tsbot 引擎启动序列");

// TODO 1. 初始化模型 Provider（大脑）
// const provider = new AnthropicProvider(...)

// TODO 2. 初始化 Tool Registry（手脚）
// const registry = new Registry()
// registry.register(new BashTool(workDir))

// TODO 3. 初始化上下文管理器（内存管理器）
// const session = sessionManager.getOrCreate("cli_default_session", workDir)

// TODO 4. 组装并启动核心 Engine（心脏）
// const engine = new AgentEngine(provider, registry, ...)
// await engine.run(session, "帮我看看当前目录下的文件，并输出一个 README.md 大纲")

console.log("骨架搭建完毕，等待各模块注入！");
