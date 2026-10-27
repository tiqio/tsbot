/**
 * ch22：给中间件一条"拿得到当前会话 Reporter"的通道。
 *
 * Go 版用 context.WithValue 把 reporter 塞进 ctx，中间件再从 ctx 取出来。
 * TS 的对应物是 AsyncLocalStorage：不污染函数签名，又能跨 await 传递。
 *
 * 为什么需要它：审批中间件要往"发起这次调用的那个群"发卡片，
 * 而注册表是全局的，它不该知道是哪个群在跑。
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface Notifier {
  /** 发一条纯文本通知（飞书消息 / 终端打印 / WebSocket 推送） */
  notify(text: string): void;
}

const storage = new AsyncLocalStorage<Notifier>();

/** 在"当前请求的 notifier"作用域里执行一段逻辑 */
export function runWithNotifier<T>(notifier: Notifier, fn: () => Promise<T>): Promise<T> {
  return storage.run(notifier, fn);
}

export function currentNotifier(): Notifier | undefined {
  return storage.getStore();
}
