import type { AiProvider, CompleteParams } from "./ai.types.js";

/**
 * Stateless provider callers. Each takes an apiKey + model + the normalized
 * request and returns the model's text reply. Uses Node's global fetch (Node 18+).
 * Errors throw with the provider's message so the controller can surface a 502.
 */

const DEFAULT_MAX_TOKENS = 1024;

async function callAnthropic(
  apiKey: string,
  model: string,
  params: CompleteParams,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.system ? { system: params.system } : {}),
      messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `Anthropic HTTP ${res.status}`);
  }
  const text = json?.content?.find((b: any) => b.type === "text")?.text;
  return (text ?? "").trim();
}

async function callOpenAI(
  apiKey: string,
  model: string,
  params: CompleteParams,
): Promise<string> {
  const messages = [
    ...(params.system ? [{ role: "system", content: params.system }] : []),
    ...params.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `OpenAI HTTP ${res.status}`);
  }
  return (json?.choices?.[0]?.message?.content ?? "").trim();
}

async function callGemini(
  apiKey: string,
  model: string,
  params: CompleteParams,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...(params.system
        ? { systemInstruction: { parts: [{ text: params.system }] } }
        : {}),
      contents: params.messages.map((m) => ({
        // Gemini uses "model" instead of "assistant".
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
      },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `Gemini HTTP ${res.status}`);
  }
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p: any) => p.text ?? "")
    .join("")
    .trim();
}

const CALLERS: Record<
  AiProvider,
  (apiKey: string, model: string, params: CompleteParams) => Promise<string>
> = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  gemini: callGemini,
};

export function callProvider(
  provider: AiProvider,
  apiKey: string,
  model: string,
  params: CompleteParams,
): Promise<string> {
  const caller = CALLERS[provider];
  if (!caller) throw new Error(`Unsupported AI provider: ${provider}`);
  return caller(apiKey, model, params);
}
