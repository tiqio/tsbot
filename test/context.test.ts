import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PromptComposer } from "../src/context/composer";
import { SkillLoader, parseSkillMd } from "../src/context/skill";

describe("SKILL.md 解析", () => {
  test("剥离 frontmatter，读出 name / description", () => {
    const content = [
      "---",
      "name: ops_troubleshoot",
      "description: Nginx 502 排查",
      "---",
      "",
      "# 排查步骤",
      "1. 先看 error.log",
    ].join("\n");

    const skill = parseSkillMd(content);
    expect(skill.name).toBe("ops_troubleshoot");
    expect(skill.description).toBe("Nginx 502 排查");
    expect(skill.body.startsWith("# 排查步骤")).toBe(true);
  });

  test("没有 frontmatter 时整体当正文，不报错", () => {
    const skill = parseSkillMd("# 只有正文");
    expect(skill.name).toBe("Unknown Skill");
    expect(skill.body).toBe("# 只有正文");
  });

  test("没有技能目录时 LoadAll 返回空串", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tsbot-skill-"));
    expect(await new SkillLoader(dir).loadAll()).toBe("");
  });
});

describe("PromptComposer", () => {
  test("拼进 AGENTS.md 与技能正文", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tsbot-prompt-"));
    await writeFile(join(dir, "AGENTS.md"), "红线：先读后改", "utf8");
    await mkdir(join(dir, ".claw", "skills", "demo"), { recursive: true });
    await writeFile(
      join(dir, ".claw", "skills", "demo", "SKILL.md"),
      "---\nname: demo-skill\ndescription: 演示技能\n---\n说人话。",
      "utf8",
    );

    const message = await new PromptComposer(dir).build();
    expect(message.role).toBe("system");
    expect(message.content).toContain("红线：先读后改");
    expect(message.content).toContain("demo-skill");
    expect(message.content).toContain("说人话。");
  });

  test("系统提示里写明当前 shell，避免模型在 Windows 上敲 ls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tsbot-prompt-"));
    const message = await new PromptComposer(dir).build();

    expect(message.content).toContain("运行环境");
    expect(message.content).toContain("Shell:");
    if (process.platform === "win32") {
      expect(message.content).toContain("cmd.exe");
    }
  });
});
