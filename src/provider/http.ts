/**
 * ch04：把 HTTP 细节收敛成一个函数。
 *
 * 相比 Go 版依赖 anthropic-sdk-go / openai-go，这里刻意不引任何 SDK：
 * 一本"从零构建"的书，模型协议本身就该被看见。
 */

export interface PostOptions {
  headers: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** 把调用方的取消信号和超时合并成一个信号 */
export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function postJson<T>(
  url: string,
  body: unknown,
  options: PostOptions,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...options.headers },
    body: JSON.stringify(body),
    signal: withTimeout(options.signal, options.timeoutMs ?? 120_000),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}\n${raw.slice(0, 800)}`);
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`响应不是合法 JSON：${raw.slice(0, 200)}`);
  }
}
