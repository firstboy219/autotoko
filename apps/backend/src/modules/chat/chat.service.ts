import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { marketplaceConversations, marketplaceMessages, orders } from "../../database/schema/index.js";
import { MarketplaceSyncService } from "../marketplace-sync/marketplace-sync.service.js";

/**
 * Chat pelanggan (Fase 1) — fondasi. Baca percakapan/pesan dari tabel kita, dan
 * ANTREKAN balasan (status 'queued'). Pengiriman & sinkronisasi ke TikTok IM
 * menyusul (dorman sampai scope IM aktif): begitu aktif, sebuah task tinggal
 * menarik percakapan masuk + mem-flush yang 'queued'. Dengan begitu UI sudah
 * bisa dibangun & diuji tanpa memicu apa pun yang live.
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly sync: MarketplaceSyncService,
  ) {}

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
    const conv = await this.milik(userId, convId);
    // Best-effort: tarik pesan terbaru dari TikTok + tandai dibaca (dorman bila scope CS belum aktif).
    if (conv.shopId && conv.conversationId) {
      try { await this.sync.syncPesanPercakapan(userId, conv.shopId, conv.conversationId, conv.id); } catch { /* scope belum aktif / error API */ }
      try {
        await this.sync.tandaiDibacaChat(userId, conv.shopId, conv.conversationId);
        await this.db.update(marketplaceConversations).set({ unread: 0, updatedAt: new Date() }).where(eq(marketplaceConversations.id, conv.id));
      } catch { /* abaikan */ }
    }
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
  /**
   * Kirim balasan seller ke pembeli via TikTok IM. Kalau scope CS aktif -> benar
   * terkirim (status 'sent' + message_id). Kalau belum aktif / gagal -> tetap
   * dicatat 'queued' + kembalikan error, jadi pesan tak hilang & UI jelas.
   */
  async reply(userId: string, convId: string, text: string) {
    const conv = await this.milik(userId, convId);
    let sent = false;
    let mid = "";
    let error: string | undefined;
    if (conv.shopId && conv.conversationId) {
      try { mid = await this.sync.kirimPesanChat(userId, conv.shopId, conv.conversationId, text); sent = true; }
      catch (e) { error = (e as Error).message; }
    } else {
      error = "Percakapan belum tertaut ke toko";
    }
    const [msg] = await this.db
      .insert(marketplaceMessages)
      .values({
        userId, conversationId: conv.id, direction: "out", sender: "seller", text,
        status: sent ? "sent" : "queued", marketplaceMessageId: sent && mid ? mid : null,
      })
      .returning();
    await this.db
      .update(marketplaceConversations)
      .set({ lastMessage: text, lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(marketplaceConversations.id, conv.id));
    return { sent, queued: !sent, error, message: msg };
  }

  /** Mulai percakapan dari sebuah order (pakai buyer user_id). Return id percakapan kita. */
  async startFromOrder(userId: string, orderId: string) {
    const [o] = await this.db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).limit(1);
    if (!o) throw new NotFoundException("Order tidak ditemukan");
    if (!o.shopId) throw new BadRequestException("Order tidak tertaut ke toko");
    const raw = (o.raw ?? {}) as Record<string, unknown>;
    const buyerUserId = String(raw.user_id ?? raw.buyer_user_id ?? "");
    if (!buyerUserId) throw new BadRequestException("ID pembeli tak tersedia di order ini");
    const cid = await this.sync.buatPercakapanChat(userId, o.shopId, buyerUserId);
    if (!cid) throw new BadRequestException("Gagal membuat percakapan di TikTok");
    const [conv] = await this.db
      .insert(marketplaceConversations)
      .values({ userId, shopId: o.shopId, marketplace: "tiktok", conversationId: cid, buyerName: o.buyerName ?? null, unread: 0 })
      .onConflictDoUpdate({
        target: [marketplaceConversations.userId, marketplaceConversations.marketplace, marketplaceConversations.conversationId],
        set: { shopId: o.shopId, updatedAt: new Date() },
      })
      .returning();
    if (!conv) throw new BadRequestException("Gagal menyimpan percakapan");
    return { conversationId: conv.id };
  }
}
