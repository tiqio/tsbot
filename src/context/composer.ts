/**
 * ch10：系统提示词组装。
 *
 * 原书叫它 Prompt Composer，因为它不是一句静态 prompt，而是由
 * 身份 + 纪律 + 项目规范(AGENTS.md) + 技能(.claw/skills) 拼出来的，
 * ch13 还会再加一段 Plan Mode 的长程任务规范。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Message } from "../schema/message.ts";
import { SkillLoader } from "./skill.ts";

export class PromptComposer {
  private readonly skillLoader: SkillLoader;

  constructor(
    private readonly workDir: string,
    private readonly planMode = false,
  ) {
    this.skillLoader = new SkillLoader(workDir);
  }

  async build(): Promise<Message> {
    let prompt = `# 核心身份
你名叫 tsbot，一个由驾驭工程驱动的研发助手。
你具备极简主义哲学，拒绝废话。你能通过系统提供的内置工具，创建、读取、修改和执行工作区中的代码。

# 核心纪律 (CRITICAL)
1. 如需检查文件是否存在，请使用 bash 的 ls 或 test -f，而不是对目录使用 read_file。
2. 创建新文件时，务必使用 write_file，并同时提供 path 和 content 参数。
3. 编辑文件前务必先读取现有文件，以理解上下文。
4. 无论何时你需要写代码或创建文件，都要直接使用 write_file 工具。
5. 遇到工具执行报错时，仔细阅读 stderr，尝试自己修正命令并重试。
6. 始终用中文回复，以便传达你的进展和想法。
`;

    if (this.planMode) {
      prompt += `
# 长程任务与状态外部化强制规范 (Plan Mode: ON)

!!! 警告：本模式下，你绝对不能依赖自己的短期记忆。你必须把架构思路和执行进度持久化到物理文件。 !!!

当你收到一条新指令被唤醒时，必须按以下【绝对顺序】行动：

**[STEP 1: 强制环境嗅探]** 先用 bash 检查工作区根目录是否已有 PLAN.md 与 TODO.md。
- 分支 A（全新任务）：用 write_file 依次创建 PLAN.md（理解与方案）和 TODO.md（可勾选的步骤）。
- 分支 B（断点续传）：绝对不要覆盖它们！先 read_file 读 PLAN.md 了解全局，再读 TODO.md 找到第一个未打勾的 \`- [ ]\`，从那里继续。

**[STEP 2: 单步执行与实时打勾]** 每完成一个子任务，必须立即用 edit_file 把 TODO.md 中对应行改为 \`- [x]\`。绝不允许"一口气写完再打勾"。

**[STEP 3: 迷失时自救]** 遇到报错或不知道下一步时，立即 read_file 重读 TODO.md 确认位置。
`;
    }

    // 项目专属规范
    try {
      const agents = await readFile(join(this.workDir, "AGENTS.md"), "utf8");
      prompt += `\n# 项目专属指南 (来自 AGENTS.md)\n\`\`\`markdown\n${agents}\n\`\`\`\n`;
    } catch {
      // 没有 AGENTS.md 就跳过，不算错误
    }

    // 动态加载技能
    prompt += await this.skillLoader.loadAll();

    return { role: "system", content: prompt };
  }
}
