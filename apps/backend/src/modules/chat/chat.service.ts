import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { marketplaceConversations, marketplaceMessages } from "../../database/schema/index.js";

/**
 * Chat pelanggan (Fase 1) — fondasi. Baca percakapan/pesan dari tabel kita, dan
 * ANTREKAN balasan (status 'queued'). Pengiriman & sinkronisasi ke TikTok IM
 * menyusul (dorman sampai scope IM aktif): begitu aktif, sebuah task tinggal
 * menarik percakapan masuk + mem-flush yang 'queued'. Dengan begitu UI sudah
 * bisa dibangun & diuji tanpa memicu apa pun yang live.
 */
@Injectable()
export class ChatService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async listConversations(userId: string) {
    return this.db
      .select()
      .from(marketplaceConversations)
      .where(eq(marketplaceConversations.userId, userId))
      .orderBy(desc(marketplaceConversations.lastMessageAt))
      .limit(200);
  }

  private async milik(userId: string, convId: string) {
    const [c] = await this.db
      .select()
      .from(marketplaceConversations)
      .where(and(eq(marketplaceConversations.id, convId), eq(marketplaceConversations.userId, userId)))
      .limit(1);
    if (!c) throw new NotFoundException("Percakapan tidak ditemukan");
    return c;
  }

  async listMessages(userId: string, convId: string) {
    await this.milik(userId, convId);
    return this.db
      .select()
      .from(marketplaceMessages)
      .where(and(eq(marketplaceMessages.conversationId, convId), eq(marketplaceMessages.userId, userId)))
      .orderBy(marketplaceMessages.createdAt);
  }

  /**
   * Antrekan balasan seller. Belum benar-benar dikirim ke marketplace — itu
   * langkah ber-scope yang menyusul; di sini pesan disimpan 'queued' agar
   * tercatat & tampil, lalu di-flush oleh task IM saat koneksi aktif.
   */
  async reply(userId: string, convId: string, text: string) {
    const conv = await this.milik(userId, convId);
    const [msg] = await this.db
      .insert(marketplaceMessages)
      .values({ userId, conversationId: conv.id, direction: "out", sender: "seller", text, status: "queued" })
      .returning();
    await this.db
      .update(marketplaceConversations)
      .set({ lastMessage: text, lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(marketplaceConversations.id, conv.id));
    return { queued: true, message: msg };
  }
}
