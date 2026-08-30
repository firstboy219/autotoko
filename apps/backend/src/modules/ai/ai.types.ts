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
  // Alat pencarian web (web_search_20260209) menuntut model 4.6 ke atas;
  // yang terbaru sekaligus yang paling mampu, dan pemilik toko tetap bisa
  // menimpanya per fitur dari Admin CMS.
  anthropic: "claude-opus-5",
  openai: "gpt-4o",
  gemini: "gemini-1.5-pro",
};

/** Autopilot features. The string value is the key suffix used in admin_settings. */
export type AiFeature =
  | "buyer_chat"
  | "affiliate_chat"
  | "review_reply"
  | "auto_approve"
  | "product_optimize"
  | "saran_bisnis";

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
  {
    key: "saran_bisnis",
    label: "Saran Bisnis",
    description:
      "Membaca data toko sendiri (produk, HPP, dashboard) dan memberi saran " +
      "untuk pemiliknya. Kalau penyedianya mendukung pencarian web, tren " +
      "pasar Indonesia ikut dibaca; kalau tidak, saran tetap jalan dari " +
      "pengetahuan model dan asalnya dinyatakan apa adanya.",
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

/** Satu rujukan yang benar-benar dibuka model saat mencari tren. */
export interface SumberTren {
  judul: string;
  url: string;
}

/**
 * Hasil lengkap sebuah panggilan, berikut ASAL trennya.
 *
 * Asalnya ikut dibawa karena hanya sebagian penyedia yang bisa membaca
 * internet. Menyebut jawaban dari pengetahuan model sebagai "tren internet"
 * adalah kebohongan kecil yang persis merusak gunanya fitur ini.
 */
export interface HasilLengkap {
  teks: string;
  sumber: SumberTren[];
  caraDapatTren: "pencarian_web" | "pengetahuan_model" | "tidak_ada";
}

/** Penyedia yang punya alat pencarian web bawaan. */
export const PENYEDIA_BISA_CARI: AiProvider[] = ["anthropic"];

export interface ResolvedFeatureConfig {
  feature: AiFeature;
  provider: AiProvider;
  model: string;
}
