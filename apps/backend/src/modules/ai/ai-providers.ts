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

/**
 * Anthropic dengan alat pencarian web bawaan.
 *
 * DIPISAH dari callAnthropic(), bukan menggantikannya. callProvider() dan
 * ketiga penyedia tidak berubah sama sekali; ini kemampuan tambahan yang
 * dipakai hanya kalau pemanggilnya memintanya DAN penyedianya memilikinya.
 *
 * Alatnya berjalan di sisi Anthropic -- tidak ada gelung tool-use yang perlu
 * ditulis di sini. Yang kembali sudah berupa jawaban akhir, dengan blok hasil
 * pencarian di antara blok teksnya.
 */
async function callAnthropicCari(
  apiKey: string,
  model: string,
  params: CompleteParams,
  petunjuk: string,
): Promise<{ teks: string; sumber: { judul: string; url: string }[] }> {
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
      ...(params.system ? { system: params.system } : {}),
      // Adaptif, bukan anggaran token tetap: anggaran tetap sudah ditolak
      // model 4.7 ke atas, dan alat pencarian ini memang menuntut 4.6 ke atas.
      thinking: { type: "adaptive" },
      tools: [
        {
          type: "web_search_20260209",
          name: "web_search",
          // Dibatasi supaya satu permintaan saran tidak berubah menjadi
          // penelusuran panjang yang mahal dan lambat di depan orang yang
          // sedang menunggu layar.
          max_uses: 5,
        },
      ],
      messages: [
        ...params.messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: petunjuk },
      ],
    }),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `Anthropic HTTP ${res.status}`);
  }

  const blok: any[] = Array.isArray(json?.content) ? json.content : [];
  const teks = blok
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();

  // Galat alat TIDAK dilempar oleh server: ia kembali sebagai HTTP 200 dengan
  // content berupa OBJEK galat, bukan larik hasil. Membacanya sebagai larik
  // akan menghasilkan daftar sumber kosong tanpa ada yang tahu kenapa.
  const sumber: { judul: string; url: string }[] = [];
  for (const b of blok) {
    if (b?.type !== "web_search_tool_result") continue;
    if (!Array.isArray(b.content)) continue;
    for (const r of b.content) {
      if (r?.type === "web_search_result" && typeof r.url === "string") {
        sumber.push({ judul: String(r.title ?? r.url).slice(0, 200), url: r.url });
      }
    }
  }
  return { teks, sumber };
}

export { callAnthropicCari };

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
