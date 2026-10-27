/**
 * ch10：Skill 加载器。
 *
 * 一个技能就是一个带 YAML frontmatter 的 SKILL.md。
 * 这里手写 frontmatter 解析，只认 name / description 两个字段——
 * 技能正文才是给模型看的指令，其余元数据留给未来的路由用。
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface Skill {
  name: string;
  description: string;
  body: string;
}

export function parseSkillMd(content: string): Skill {
  const skill: Skill = {
    name: "Unknown Skill",
    description: "No description provided.",
    body: content,
  };

  if (!content.startsWith("---")) return skill;

  const parts = content.split("---");
  if (parts.length < 3) return skill;

  const frontmatter = parts[1] ?? "";
  skill.body = (parts.slice(2).join("---") ?? "").trim();

  for (const rawLine of frontmatter.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("name:")) {
      skill.name = line.slice("name:".length).trim();
    } else if (line.startsWith("description:")) {
      skill.description = line.slice("description:".length).trim();
    }
  }

  return skill;
}

export class SkillLoader {
  constructor(private readonly workDir: string) {}

  /** 递归扫描 .claw/skills 目录下的所有 SKILL.md，拼成一段可塞进系统提示的词条 */
  async loadAll(): Promise<string> {
    const baseDir = join(this.workDir, ".claw", "skills");

    let entries: string[];
    try {
      entries = (await readdir(baseDir, { recursive: true })).map(String);
    } catch {
      return ""; // 没有技能目录就是没有技能，不是错误
    }

    const skillFiles = entries
      .filter((entry) => entry.endsWith("SKILL.md"))
      .map((entry) => join(baseDir, entry));

    if (skillFiles.length === 0) return "";

    let out = "\n### 可用专业技能 (Agent Skills)\n";
    out += "以下是你拥有的标准化外挂技能，请在符合 description 描述的场景下严格遵循其正文指令：\n\n";

    for (const file of skillFiles) {
      const skill = parseSkillMd(await readFile(file, "utf8"));
      out += `#### 技能名称: ${skill.name}\n`;
      out += `**触发条件**: ${skill.description}\n\n`;
      out += `**执行指南**:\n${skill.body}\n\n---\n`;
    }

    return out;
  }
}
