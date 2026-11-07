import dns from "dns";
dns.setDefaultResultOrder?.("ipv4first");

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AIQuotaExceededError, tryConsumeAIRequest } from "./quota";

export type LLMProvider = "anthropic" | "gemini" | "qwen";

let _providerCalls = 0;
let _mockProvider: ((opts: CompleteOptions, info: ProviderInfo) => Promise<string> | string) | null = null;

export function getProviderCallCount(): number {
  return _providerCalls;
}

export function resetProviderCallCount(): void {
  _providerCalls = 0;
}

export function setMockProviderForTests(fn: ((opts: CompleteOptions, info: ProviderInfo) => Promise<string> | string) | null): void {
  _mockProvider = fn;
}

export interface CompleteOptions {
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
  model?: string;
}

export interface ProviderInfo {
  provider: LLMProvider;
  model: string;
  deepModel: string;
  hasKey: boolean;
  label: string;
  baseURL?: string;
}

/**
 * Resolve the active LLM provider and credentials.
 * Checked in order: NIGHTWATCH_PROVIDER, or inferred if only one provider key is present.
 */
export function getProviderInfo(): ProviderInfo {
  const explicit = (process.env.NIGHTWATCH_PROVIDER || "").toLowerCase().trim() as LLMProvider;
  let provider: LLMProvider = "anthropic";

  if (explicit === "gemini" || explicit === "qwen" || explicit === "anthropic") {
    provider = explicit;
  } else if (process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.DASHSCOPE_API_KEY) {
    provider = "gemini";
  } else if (process.env.DASHSCOPE_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
    provider = "qwen";
  }

  let model = process.env.NIGHTWATCH_MODEL;
  let deepModel = process.env.NIGHTWATCH_DEEP_MODEL;
  let hasKey = false;
  let label = "Anthropic";
  let baseURL: string | undefined;

  switch (provider) {
    case "gemini":
      label = "Google Gemini";
      model = model || "gemini-3.5-flash";
      deepModel = deepModel || "gemini-3.5-flash";
      hasKey = !!process.env.GEMINI_API_KEY;
      baseURL = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/";
      break;

    case "qwen":
      label = "Alibaba Qwen";
      model = model || "qwen-plus";
      deepModel = deepModel || "qwen-max";
      hasKey = !!process.env.DASHSCOPE_API_KEY;
      // International Singapore endpoint by default; configurable via DASHSCOPE_BASE_URL
      baseURL = process.env.DASHSCOPE_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
      break;

    case "anthropic":
    default:
      provider = "anthropic";
      label = "Anthropic Claude";
      model = model || "claude-sonnet-5-5";
      deepModel = deepModel || model;
      hasKey = !!process.env.ANTHROPIC_API_KEY;
      break;
  }

  return { provider, model, deepModel, hasKey, label, baseURL };
}

export function aiAvailable(): boolean {
  return getProviderInfo().hasKey;
}

/**
 * Defensive JSON extraction from model outputs.
 * Handles markdown fences (```json ... ```), preamble/trailing notes, and unescaped whitespace.
 */
export function defensiveExtractJson<T = any>(text: string): T {
  if (!text || typeof text !== "string") {
    throw new Error("Model returned empty response");
  }

  let raw = text.trim();

  // Strip standard markdown code blocks if the entire response is wrapped in one
  const codeBlockMatch = raw.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (codeBlockMatch) {
    raw = codeBlockMatch[1].trim();
  }

  // First try direct parse
  try {
    return JSON.parse(raw);
  } catch {}

  // Find the first outer JSON object {...} or array [...]
  const firstBrace = raw.indexOf("{");
  const firstBracket = raw.indexOf("[");
  let start = -1;
  let end = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    start = firstBrace;
    end = raw.lastIndexOf("}");
  } else if (firstBracket !== -1) {
    start = firstBracket;
    end = raw.lastIndexOf("]");
  }

  if (start >= 0 && end > start) {
    const candidate = raw.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  throw new Error("Model response did not contain parseable JSON");
}

async function callWith429Backoff<T>(fn: () => Promise<T>, provider: string, maxRetries = 5, baseDelayMs = 12000): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      const isRetryable =
        err?.status === 429 ||
        err?.statusCode === 429 ||
        err?.status === 503 ||
        err?.statusCode === 503 ||
        /429|503|quota|rate limit|resource_exhausted|high demand|unavailable|temporarily/i.test(err?.message || "");

      if (isRetryable && attempt < maxRetries) {
        attempt++;
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 1000);
        console.warn(`[llm:${provider}] Rate limit or service demand spike (${err?.status || err?.message}). Backing off for ${Math.round(delay / 1000)}s (retry ${attempt}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Provider-agnostic LLM completion.
 * Dispatches to Anthropic SDK or OpenAI-compatible endpoint (Gemini, Qwen).
 */
export async function complete(opts: CompleteOptions): Promise<string> {
  const info = getProviderInfo();
  if (!info.hasKey && !_mockProvider) {
    throw new Error(`API key for provider '${info.provider}' is not configured on this server.`);
  }

  if (!tryConsumeAIRequest()) {
    throw new AIQuotaExceededError();
  }
  _providerCalls++;

  if (_mockProvider) {
    return await _mockProvider(opts, info);
  }

  const model = opts.model || info.model;
  const maxTokens = Math.min(opts.maxTokens ?? 12000, 16000);

  return callWith429Backoff(async () => {
    if (info.provider === "anthropic") {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
      });
      return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    }

    if (info.provider === "gemini") {
      const client = new OpenAI({
        apiKey: process.env.GEMINI_API_KEY,
        baseURL: info.baseURL,
      });
      const res = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      });
      return res.choices[0]?.message?.content || "";
    }

    if (info.provider === "qwen") {
      const client = new OpenAI({
        apiKey: process.env.DASHSCOPE_API_KEY,
        baseURL: info.baseURL,
      });
      const res = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      });
      return res.choices[0]?.message?.content || "";
    }

    throw new Error(`Unsupported LLM provider: ${info.provider}`);
  }, info.provider);
}
