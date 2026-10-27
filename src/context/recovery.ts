/**
 * ch14：工具失败后的"救援指南"。
 *
 * 模型看到 "ENOENT" 往往不知道该怎么办，看到
 * "路径不对，先 ls 一下再猜" 就会自己修。
 * 这一层不改错误原文，只在后面追加一段行动建议。
 *
 * 与 Go 版的差异：Node 的错误文本是英文 + errno 码（ENOENT / EACCES），
 * 所以匹配表里把 POSIX 措辞和错误码都覆盖了。
 */
const HINTS: Array<{
  tools: string[] | "any";
  match: RegExp;
  hint: string;
}> = [
  {
    tools: ["edit_file"],
    match: /未找到 old_text|找不到该代码片段|not found in file/i,
    hint: "你提供的 old_text 与文件当前内容不一致，或者缺少必要的缩进。请先使用 read_file 重新读取该文件，拿到最新内容后再编辑。",
  },
  {
    tools: ["edit_file"],
    match: /匹配到了 \d+ 处|模糊匹配到了 \d+ 处/,
    hint: "你的 old_text 不够具体，命中了多个相同代码块。请在 old_text 中增加上下相邻的几行代码，确保唯一。",
  },
  {
    tools: ["read_file", "write_file", "edit_file"],
    match: /no such file or directory|ENOENT/i,
    hint: "路径似乎不正确。不要凭空猜测，先用 bash 执行 ls 或 find 命令查清目录结构。",
  },
  {
    tools: ["read_file", "write_file", "edit_file"],
    match: /permission denied|EACCES|EPERM/i,
    hint: "你没有权限操作这个文件。检查路径是否在工作区内，或者换一个可写的位置。",
  },
  {
    tools: ["bash"],
    match: /command not found|不是内部或外部命令|is not recognized as an internal or external command/i,
    hint: "系统里没有这个命令。先想清楚：有没有等价命令？或者需要先安装/换一种写法？",
  },
  {
    tools: ["bash"],
    match: /超时|ETIMEDOUT|timed out/i,
    hint: "命令被执行期限强杀。如果它是常驻服务，请放到后台执行（例如 nohup ... &），不要阻塞主循环。",
  },
  {
    tools: ["bash"],
    match: /syntax error|语法错误/i,
    hint: "Shell 语法错误。检查引号、转义和特殊字符，确认命令能直接在终端里跑通。",
  },
];

export class RecoveryManager {
  /** 命中已知特征就在原始错误后追加行动建议；否则原样返回 */
  analyzeAndInject(toolName: string, rawError: string): string {
    for (const { tools, match, hint } of HINTS) {
      if (tools !== "any" && !tools.includes(toolName)) continue;
      if (!match.test(rawError)) continue;
      return `${rawError}\n\n[系统救援指南]: ${hint}`;
    }
    return rawError;
  }
}
