import { Injectable } from "@nestjs/common";
import { AiProviderService } from "./ai-provider.service.js";
import type { ChatMessage } from "./ai.types.js";

/**
 * High-level autopilot features. Each picks up the provider/model the owner
 * assigned to it in the Admin CMS (via AiProviderService.complete(feature, …)).
 */
@Injectable()
export class AiService {
  constructor(private readonly ai: AiProviderService) {}

  private toMessages(message: string, history?: ChatMessage[]): ChatMessage[] {
    return [...(history ?? []), { role: "user", content: message }];
  }

  /** Reply to a buyer's chat/question. */
  async buyerChat(input: {
    message: string;
    history?: ChatMessage[];
    storeName?: string;
    productContext?: string;
  }): Promise<string> {
    const system = [
      `Kamu adalah customer service toko online${input.storeName ? ` "${input.storeName}"` : ""} di marketplace Indonesia (TikTok Shop/Shopee).`,
      "Balas ramah, singkat, sopan, pakai Bahasa Indonesia. Dorong pembelian tanpa memaksa.",
      input.productContext ? `Konteks produk:\n${input.productContext}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return this.ai.complete("buyer_chat", {
      system,
      messages: this.toMessages(input.message, input.history),
    });
  }

  /** Reply to an affiliator/creator. */
  async affiliateChat(input: {
    message: string;
    history?: ChatMessage[];
    storeName?: string;
    commissionInfo?: string;
  }): Promise<string> {
    const system = [
      `Kamu adalah tim kemitraan/affiliate toko${input.storeName ? ` "${input.storeName}"` : ""}.`,
      "Balas profesional & persuasif dalam Bahasa Indonesia, ajak kreator promosikan produk.",
      input.commissionInfo ? `Info komisi: ${input.commissionInfo}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return this.ai.complete("affiliate_chat", {
      system,
      messages: this.toMessages(input.message, input.history),
    });
  }

  /** Draft a reply to a product review. */
  async reviewReply(input: {
    review: string;
    rating?: number;
    productName?: string;
    storeName?: string;
  }): Promise<string> {
    const system = [
      `Kamu menulis balasan ulasan untuk toko${input.storeName ? ` "${input.storeName}"` : ""}.`,
      "Balas singkat, sopan, berterima kasih. Untuk rating rendah, minta maaf & tawarkan solusi. Bahasa Indonesia.",
    ].join("\n");
    const ctx = [
      input.productName ? `Produk: ${input.productName}` : "",
      input.rating != null ? `Rating: ${input.rating}/5` : "",
      `Ulasan: ${input.review}`,
    ]
      .filter(Boolean)
      .join("\n");
    return this.ai.complete("review_reply", {
      system,
      messages: [{ role: "user", content: ctx }],
    });
  }

  /**
   * Decide whether an order is safe to auto-approve. Returns a structured verdict.
   * The model is asked for strict JSON; we parse defensively.
   */
  async autoApprove(order: {
    total?: number;
    buyerName?: string;
    itemCount?: number;
    notes?: string;
    raw?: unknown;
  }): Promise<{ approve: boolean; reason: string }> {
    const system = [
      "Kamu adalah verifikator pesanan toko online. Putuskan apakah pesanan aman disetujui otomatis.",
      "Tolak (approve=false) jika ada indikasi penipuan, alamat janggal, jumlah tak wajar, atau catatan mencurigakan.",
      'Jawab HANYA JSON: {"approve": true|false, "reason": "alasan singkat Bahasa Indonesia"}.',
    ].join("\n");
    const payload = JSON.stringify(
      {
        total: order.total,
        buyerName: order.buyerName,
        itemCount: order.itemCount,
        notes: order.notes,
        raw: order.raw,
      },
      null,
      2,
    );
    const text = await this.ai.complete("auto_approve", {
      system,
      messages: [{ role: "user", content: `Pesanan:\n${payload}` }],
      maxTokens: 300,
      temperature: 0,
    });
    return this.parseVerdict(text);
  }

  private parseVerdict(text: string): { approve: boolean; reason: string } {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        return {
          approve: Boolean(obj.approve),
          reason: String(obj.reason ?? "").slice(0, 500),
        };
      } catch {
        /* fall through */
      }
    }
    // Conservative default: don't auto-approve if the model didn't give clean JSON.
    return { approve: false, reason: `Tidak bisa parse keputusan AI: ${text.slice(0, 200)}` };
  }

  /** Rewrite a product's title + description for conversions/SEO. */
  async optimizeProduct(input: {
    name: string;
    description?: string;
    category?: string;
    keywords?: string;
  }): Promise<{ title: string; description: string }> {
    const system = [
      "Kamu copywriter produk e-commerce Indonesia (TikTok Shop/Shopee).",
      "Tulis ulang judul (maks 255 char, kaya kata kunci) dan deskripsi (persuasif, ada bullet manfaat, CTA).",
      'Jawab HANYA JSON: {"title": "...", "description": "..."}.',
    ].join("\n");
    const ctx = [
      `Nama: ${input.name}`,
      input.category ? `Kategori: ${input.category}` : "",
      input.keywords ? `Kata kunci: ${input.keywords}` : "",
      input.description ? `Deskripsi saat ini: ${input.description}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const text = await this.ai.complete("product_optimize", {
      system,
      messages: [{ role: "user", content: ctx }],
      maxTokens: 1200,
    });
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        if (obj.title || obj.description) {
          return {
            title: String(obj.title ?? input.name),
            description: String(obj.description ?? ""),
          };
        }
      } catch {
        /* fall through */
      }
    }
    // If not JSON, treat the whole reply as the new description.
    return { title: input.name, description: text };
  }
}
