/**
 * ch16：人工审批闸门。
 *
 * Go 版用 chan ApprovalResult 把当前 goroutine 挂起；TS 里就是一个
 * 永不 resolve 的 Promise，由飞书回来的 "approve xxx" 消息把它 resolve 掉。
 * 语义完全一样，代码少一半。
 */
export interface ApprovalResult {
  allowed: boolean;
  reason: string;
}

interface Pending {
  resolve: (result: ApprovalResult) => void;
}

/** 发送审批卡片的方式由调用方注入：飞书群、终端、Web 都行 */
export type ApprovalNotifier = (text: string) => void;

export class ApprovalManager {
  private readonly pending = new Map<string, Pending>();

  /**
   * 挂起等待人工决定。
   * 先登记再通知——否则审批可能在登记前就回来。
   */
  waitForApproval(
    taskId: string,
    toolName: string,
    args: string,
    notify: ApprovalNotifier,
  ): Promise<ApprovalResult> {
    const notice = `⚠️ 高危操作审批请求
Agent 试图执行以下动作:
- 工具: ${toolName}
- 参数: ${args}

任务 ID: ${taskId}

👉 请回复 "approve ${taskId}" 或 "reject ${taskId}" 决定是否放行。`;

    const promise = new Promise<ApprovalResult>((resolve) => {
      this.pending.set(taskId, { resolve });
    });

    notify(notice);
    console.log(`[Approval] 已发出审批请求 (TaskID: ${taskId})，等待人类决定...`);
    return promise;
  }

  /** 收到飞书消息后调用；找不到对应任务说明已经超时或重复，返回 false */
  resolveApproval(taskId: string, allowed: boolean, reason: string): boolean {
    const task = this.pending.get(taskId);
    if (!task) return false;

    this.pending.delete(taskId);
    console.log(`[Approval] 收到审批结果 (TaskID: ${taskId}, Allowed: ${allowed})`);
    task.resolve({ allowed, reason });
    return true;
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

export const globalApprovalManager = new ApprovalManager();

/**
 * 高危动作判定：白名单放行只读操作，写操作一律要审批，
 * bash 则走一张特征黑名单。
 */
export function isDangerousCommand(toolName: string, args: string): boolean {
  if (toolName === "read_file") return false;

  // AgentOps 场景下，改文件本身就是高危操作
  if (toolName === "write_file" || toolName === "edit_file") return true;

  if (toolName !== "bash") return false;

  const patterns: RegExp[] = [
    /rm\s+-r/i, // 级联删除
    /\bsudo\s+/i, // 提权
    /\bdrop\s+/i, // 数据库危险命令
    />.*\.(ts|go|js)/i, // 恶意覆盖源码
    /nginx\s+-s/i, // 拦截 Nginx 重启/停止
    /systemctl\s+/i, // 系统级服务管理
    /\bkill\s+/i, // 杀进程
    /\bdel\s+\/[sq]/i, // Windows 递归删除
    /\bformat\s+[a-z]:/i, // 格式化磁盘
    /\bshutdown\b/i, // 关机
    /\btaskkill\b/i, // 结束进程
    /\bnet\s+stop\b/i, // 停服务
  ];

  return patterns.some((pattern) => pattern.test(args));
}
