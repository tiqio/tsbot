/**
 * ch04：按"厂商 + 协议"两个维度选 provider。
 *
 * 同一家模型（智谱 GLM）同时提供 Anthropic 兼容端点和 OpenAI 兼容端点，
 * 这正是接口抽象存在的意义：换协议不改引擎。
 */
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import type { LLMProvider } from "./types";

export type ProviderKind =
  | "anthropic"
  | "zhipu-anthropic"
  | "openai"
  | "zhipu-openai"
  | "deepseek"
  | "mock";

interface Preset {
  protocol: "anthropic" | "openai";
  keyEnv: string;
  baseUrl?: string;
  model: string;
}

const PRESETS: Record<Exclude<ProviderKind, "mock">, Preset> = {
  anthropic: {
    protocol: "anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    model: "claude-sonnet-4-5",
  },
  "zhipu-anthropic": {
    protocol: "anthropic",
    keyEnv: "ZHIPU_API_KEY",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    model: "glm-4.5-air",
  },
  deepseek: {
    protocol: "openai",
    keyEnv: "DEEPSEEK_API_KEY",
    // 和 little-robot 的 .env 保持同一套变量名，直接 --env-file 指过去就能用
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  },
  openai: {
    protocol: "openai",
    keyEnv: "OPENAI_API_KEY",
    baseUrl: process.env.OPENAI_BASE_URL,
    model: "gpt-4o-mini",
  },
  "zhipu-openai": {
    protocol: "openai",
    keyEnv: "ZHIPU_API_KEY",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
    model: "glm-4.5-air",
  },
};

/** 按环境变量推测一个可用的 kind，供 CLI 默认值使用 */
export function detectProviderKind(): ProviderKind {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.ZHIPU_API_KEY) return "zhipu-openai";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "mock";
}

export interface ResolvedProvider {
  provider: LLMProvider;
  model: string;
  kind: ProviderKind;
}

/** mock 之外的 kind 才会返回真实 provider */
export function createProvider(kind: ProviderKind, model?: string): ResolvedProvider | undefined {
  if (kind === "mock") return undefined;

  const preset = PRESETS[kind];
  const apiKey = process.env[preset.keyEnv];
  if (!apiKey) {
    throw new Error(`缺少环境变量 ${preset.keyEnv}，无法使用 provider=${kind}`);
  }

  const resolvedModel = model ?? preset.model;

  const provider: LLMProvider =
    preset.protocol === "anthropic"
      ? new AnthropicProvider({
          apiKey,
          baseUrl: preset.baseUrl,
          model: resolvedModel,
        })
      : new OpenAIProvider({
          apiKey,
          baseUrl: preset.baseUrl,
          model: resolvedModel,
        });

  return { provider, model: resolvedModel, kind };
}
