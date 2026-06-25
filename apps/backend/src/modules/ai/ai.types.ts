/**
 * AI autopilot abstractions. Each autopilot feature can use a DIFFERENT provider
 * + model, chosen by the owner from the Admin CMS (per owner directive: e.g.
 * buyer-chat→Gemini, affiliate-chat→OpenAI, auto-approve→Claude). Nothing here
 * is hardcoded to a single vendor; provider/model/keys all live (encrypted) in
 * `admin_settings`. See [[ai-provider-configurable-cms]].
 */

/** Supported providers. Extend by adding a caller in ai-providers.ts. */
export type AiProvider = "anthropic" | "openai" | "gemini";

export const AI_PROVIDERS: AiProvider[] = ["anthropic", "openai", "gemini"];

/** The admin_settings key holding each provider's API key. */
export const PROVIDER_API_KEY: Record<AiProvider, string> = {
  anthropic: "anthropic_api_key",
  openai: "openai_api_key",
  gemini: "gemini_api_key",
};

/** Sensible default model per provider (owner can override in CMS). */
export const PROVIDER_DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-4o",
  gemini: "gemini-1.5-pro",
};

/** Autopilot features. The string value is the key suffix used in admin_settings. */
export type AiFeature =
  | "buyer_chat"
  | "affiliate_chat"
  | "review_reply"
  | "auto_approve"
  | "product_optimize";

export interface AiFeatureDef {
  key: AiFeature;
  label: string;
  description: string;
}

export const AI_FEATURES: AiFeatureDef[] = [
  {
    key: "buyer_chat",
    label: "Auto Chat Pembeli",
    description: "Membalas chat/pertanyaan pembeli secara otomatis.",
  },
  {
    key: "affiliate_chat",
    label: "Auto Chat Affiliator",
    description: "Membalas chat & negosiasi dengan affiliator/kreator.",
  },
  {
    key: "review_reply",
    label: "Auto Balas Review",
    description: "Membuat balasan sopan untuk ulasan produk.",
  },
  {
    key: "auto_approve",
    label: "Auto Approve Pesanan",
    description: "Menilai apakah pesanan aman untuk disetujui otomatis.",
  },
  {
    key: "product_optimize",
    label: "Optimasi Produk",
    description: "Menulis ulang judul & deskripsi produk agar lebih menjual (SEO).",
  },
];

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompleteParams {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ResolvedFeatureConfig {
  feature: AiFeature;
  provider: AiProvider;
  model: string;
}
