import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { and, desc, eq, gt, or, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { TenantService } from "../../database/tenant.service.js";
import {
  chatSettings,
  marketplaceConversations,
  marketplaceMessages,
  orders,
} from "../../database/schema/index.js";
import { MarketplaceSyncService } from "../marketplace-sync/marketplace-sync.service.js";
import { KbService } from "../kb/kb.service.js";
import { AutopilotLogService } from "../ai/autopilot-log.service.js";

type Obj = Record<string, any>;

export interface ChatSettingsView {
  autoReply: boolean;
  autoReplyShopIds: string[] | null;
  officeStart: number | null;
  officeEnd: number | null;
  fallbackText: string | null;
  tersimpan: boolean; // false = tabel belum dimigrasi / belum pernah disimpan
}

const DEFAULT: ChatSettingsView = {
  autoReply: false, autoReplyShopIds: null, officeStart: null, officeEnd: null, fallbackText: null, tersimpan: false,
};

/**
 * Otomasi Chat Pelanggan TikTok (Customer Service API).
 *
 * Alur tiap putaran (webhook "New message" = real-time; cron 10 mnt = jaring
 * pengaman):
 *  1) tarik daftar percakapan (syncChat) -> 2) tarik pesan percakapan yang
 *  belum terbaca/berubah -> 3) BALAS OTOMATIS pesan pembeli yang belum dijawab
 *  bila seller menyalakannya: jawaban dari Knowledge Base seller (placeholder
 *  {resi}/{status}/{pembeli}/{toko} diisi dari order terakhir pembeli itu),
 *  atau pesan "di luar jam kerja" bila KB tak cocok -> 4) kirim ulang balasan
 *  manual yang masih ter-antre.
 *
 * Pengaman: satu balasan otomatis per pesan pembeli (ditandai raw.autoReplyFor),
 * tidak membalas bila seller sudah menjawab, kunci per user agar webhook+cron
 * tak dobel, dan semua keputusan dicatat ke feed Autopilot. Dorman (tanpa
 * error berisik) selama scope Customer Service belum aktif.
 */
@Injectable()
export class ChatAutomationService {
  private readonly logger = new Logger(ChatAutomationService.name);
  private readonly sedang = new Set<string>();
  private readonly scopeCache = new Map<string, { at: number; aktif: boolean; pesan: string | null }>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly tenant: TenantService,
    private readonly sync: MarketplaceSyncService,
    private readonly kb: KbService,
    private readonly autopilot: AutopilotLogService,
  ) {}

  private bypass<T>(fn: () => Promise<T>) { return this.tenant.runBypass(fn); }

  /* ------------------------------------------------ pengaturan */

  async getSettings(userId: string): Promise<ChatSettingsView> {
    try {
      const [r] = await this.bypass(() => this.db.select().from(chatSettings).where(eq(chatSettings.userId, userId)).limit(1));
      if (!r) return { ...DEFAULT };
      return {
        autoReply: r.autoReply, autoReplyShopIds: r.autoReplyShopIds ?? null,
        officeStart: r.officeStart ?? null, officeEnd: r.officeEnd ?? null,
        fallbackText: r.fallbackText ?? null, tersimpan: true,
      };
    } catch {
      return { ...DEFAULT }; // migrasi 0081 belum dijalankan -> aman: mati
    }
  }

  async setSettings(userId: string, s: Partial<ChatSettingsView>) {
    const cur = await this.getSettings(userId);
    const v = {
      autoReply: s.autoReply ?? cur.autoReply,
      autoReplyShopIds: s.autoReplyShopIds === undefined ? cur.autoReplyShopIds : (s.autoReplyShopIds?.length ? s.autoReplyShopIds : null),
      officeStart: s.officeStart === undefined ? cur.officeStart : s.officeStart,
      officeEnd: s.officeEnd === undefined ? cur.officeEnd : s.officeEnd,
      fallbackText: s.fallbackText === undefined ? cur.fallbackText : (s.fallbackText?.trim() || null),
    };
    await this.bypass(() => this.db.insert(chatSettings).values({ userId, ...v, updatedAt: new Date() })
      .onConflictDoUpdate({ target: chatSettings.userId, set: { ...v, updatedAt: new Date() } }));
    return this.getSettings(userId);
  }

  /** Izin chat per toko (1 panggilan ringan, cache 10 menit). */
  async status(userId: string) {
    const toko = await this.sync.tokoSiap(userId);
    const out: Array<{ shopId: string; shopName: string; aktif: boolean; pesan: string | null }> = [];
    for (const t of toko) {
      if (t.marketplace !== "tiktok") continue;
      const c = this.scopeCache.get(t.id);
      if (c && Date.now() - c.at < 10 * 60e3) { out.push({ shopId: t.id, shopName: t.displayName || t.shopName || t.id, aktif: c.aktif, pesan: c.pesan }); continue; }
      let aktif = false, pesan: string | null = null;
      try {
        aktif = await this.sync.cekIzinChat(userId, t.id);
      } catch (e) {
        const m = (e as Error).message ?? "";
        pesan = /105005/.test(m) ? "Izin Customer Service belum aktif (ajukan di Partner Center lalu hubungkan ulang toko)" : m.slice(0, 160);
      }
      this.scopeCache.set(t.id, { at: Date.now(), aktif, pesan });
      out.push({ shopId: t.id, shopName: t.displayName || t.shopName || t.id, aktif, pesan });
    }
    return out;
  }

  /* ------------------------------------------------ putaran otomasi */

  /**
   * Satu putaran untuk seorang seller. `cidWebhook` = conversation_id TikTok
   * dari webhook (diproses walau unread 0). Aman dipanggil berulang.
   */
  async jalankan(userId: string, cidWebhook?: string | null) {
    if (this.sedang.has(userId)) return { dilewati: "putaran lain sedang berjalan" };
    this.sedang.add(userId);
    const ringkas = { percakapan: 0, pesanBaru: 0, dibalasOtomatis: 0, antreanTerkirim: 0, galat: [] as string[] };
    try {
      const st = await this.getSettings(userId);
      const s = await this.sync.syncChat(userId);
      ringkas.percakapan = s.conversations;
      for (const h of s.hasil) if (h.error) ringkas.galat.push(`${h.shop}: ${h.error.slice(0, 120)}`);
      if (s.conversations === 0 && !cidWebhook) {
        ringkas.antreanTerkirim = await this.flushAntrean(userId);
        return ringkas;
      }
      // Percakapan yang perlu diproses: belum terbaca, atau yang disebut webhook.
      const syarat = cidWebhook
        ? or(gt(marketplaceConversations.unread, 0), eq(marketplaceConversations.conversationId, cidWebhook))
        : gt(marketplaceConversations.unread, 0);
      const convs = await this.bypass(() => this.db.select().from(marketplaceConversations)
        .where(and(eq(marketplaceConversations.userId, userId), syarat))
        .orderBy(desc(marketplaceConversations.lastMessageAt)).limit(30));
      for (const cv of convs) {
        if (!cv.shopId) continue;
        try {
          ringkas.pesanBaru += await this.sync.syncPesanPercakapan(userId, cv.shopId, cv.conversationId, cv.id);
          if (st.autoReply && (!st.autoReplyShopIds || st.autoReplyShopIds.includes(cv.shopId))) {
            if (await this.balasOtomatis(userId, cv, st)) ringkas.dibalasOtomatis++;
          }
        } catch (e) {
          ringkas.galat.push(`${cv.buyerName ?? cv.conversationId}: ${(e as Error).message.slice(0, 120)}`);
        }
      }
      ringkas.antreanTerkirim = await this.flushAntrean(userId);
      return ringkas;
    } finally {
      this.sedang.delete(userId);
    }
  }

  private static jamWib(): number {
    return Number(new Date(Date.now() + 7 * 3600e3).toISOString().slice(11, 13));
  }

  private static diLuarJam(st: ChatSettingsView): boolean {
    if (st.officeStart == null || st.officeEnd == null) return false;
    const h = ChatAutomationService.jamWib();
    return st.officeStart <= st.officeEnd ? (h < st.officeStart || h >= st.officeEnd) : (h < st.officeStart && h >= st.officeEnd);
  }

  /** Order terakhir pembeli ini di toko ini (untuk placeholder {resi}/{status}). */
  private async orderPembeli(userId: string, shopId: string, cv: Obj): Promise<string | undefined> {
    const parts = Array.isArray(cv.raw?.participants) ? cv.raw.participants : [];
    const buyer = parts.find((p: Obj) => String(p?.role ?? "").toUpperCase() === "BUYER");
    const bid = String(buyer?.user_id ?? buyer?.buyer_user_id ?? "");
    if (!bid) return undefined;
    const [o] = await this.bypass(() => this.db.select({ id: orders.id }).from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.shopId, shopId), sql`${orders.raw}->>'user_id' = ${bid}`))
      .orderBy(desc(orders.createdAt)).limit(1));
    return o?.id;
  }

  /** Balas pesan pembeli terakhir yang belum dijawab. true = terkirim. */
  private async balasOtomatis(userId: string, cv: typeof marketplaceConversations.$inferSelect, st: ChatSettingsView): Promise<boolean> {
    const msgs = await this.bypass(() => this.db.select().from(marketplaceMessages)
      .where(and(eq(marketplaceMessages.userId, userId), eq(marketplaceMessages.conversationId, cv.id)))
      .orderBy(desc(marketplaceMessages.createdAt)).limit(20));
    if (!msgs.length || msgs[0]!.direction !== "in") return false; // seller/robot sudah menjawab terakhir
    const terakhir = msgs[0]!;
    const midTerakhir = terakhir.marketplaceMessageId ?? terakhir.id;
    if (msgs.some((m) => (m.raw as Obj | null)?.autoReplyFor === midTerakhir)) return false;
    // Gabung pesan pembeli beruntun sejak jawaban terakhir kita.
    const beruntun: string[] = [];
    for (const m of msgs) { if (m.direction !== "in") break; if (m.text) beruntun.unshift(m.text); }
    const teksPembeli = beruntun.join(" ").trim();
    if (!teksPembeli) return false;

    const orderId = await this.orderPembeli(userId, cv.shopId!, cv as Obj);
    const d = await this.kb.draft(userId, { text: teksPembeli, kind: "chat", orderId });
    let balasan: string | null = d.matched ? d.reply : null;
    let sumber = d.matched ? "kb" : "";
    if (balasan && /\{(resi|status|pembeli|toko)\}/i.test(balasan)) {
      // Order pembeli tak ketemu -> placeholder tak terisi. Jangan kirim
      // "Halo kak {pembeli}" mentah ke pembeli: biarkan untuk dijawab seller.
      void this.autopilot.record({ userId, feature: "buyer_chat", action: "auto_reply", status: "held", provider: "internal-kb",
        summary: `Ditahan: jawaban KB butuh data order, tapi order ${cv.buyerName ?? "pembeli"} tak ditemukan`, refType: "chat", refId: cv.id });
      balasan = null; sumber = "";
    }
    if (!balasan && st.fallbackText && ChatAutomationService.diLuarJam(st)) {
      const sudah = msgs.some((m) => (m.raw as Obj | null)?.autoKind === "fallback"
        && Date.now() - new Date(m.createdAt).getTime() < 12 * 3600e3);
      if (!sudah) { balasan = st.fallbackText; sumber = "fallback"; }
    }
    if (!balasan) {
      void this.autopilot.record({ userId, feature: "buyer_chat", action: "auto_reply", status: "held", provider: "internal-kb",
        summary: `Tidak dibalas otomatis (tak ada jawaban KB cocok) untuk ${cv.buyerName ?? "pembeli"}: "${teksPembeli.slice(0, 70)}"`,
        refType: "chat", refId: cv.id });
      return false;
    }
    const mid = await this.sync.kirimPesanChat(userId, cv.shopId!, cv.conversationId, balasan);
    await this.bypass(async () => {
      await this.db.insert(marketplaceMessages).values({
        userId, conversationId: cv.id, direction: "out", sender: "auto", text: balasan!,
        status: "sent", marketplaceMessageId: mid || null,
        raw: { autoReplyFor: midTerakhir, autoKind: sumber, kbEntryId: (d as Obj).entryId ?? null },
      });
      await this.db.update(marketplaceConversations)
        .set({ lastMessage: balasan!, lastMessageAt: new Date(), updatedAt: new Date() })
        .where(eq(marketplaceConversations.id, cv.id));
    });
    void this.autopilot.record({ userId, feature: "buyer_chat", action: "auto_reply", status: "done", provider: "internal-kb",
      summary: `Balas otomatis (${sumber === "kb" ? "Knowledge Base" : "di luar jam kerja"}) ke ${cv.buyerName ?? "pembeli"}: "${balasan.slice(0, 70)}"`,
      refType: "chat", refId: cv.id });
    return true;
  }

  /** Kirim ulang balasan manual yang ter-antre (maks 5 percobaan per pesan). */
  async flushAntrean(userId: string): Promise<number> {
    const antre = await this.bypass(() => this.db.select({ m: marketplaceMessages, c: marketplaceConversations })
      .from(marketplaceMessages)
      .innerJoin(marketplaceConversations, eq(marketplaceConversations.id, marketplaceMessages.conversationId))
      .where(and(eq(marketplaceMessages.userId, userId), eq(marketplaceMessages.status, "queued"), eq(marketplaceMessages.direction, "out")))
      .orderBy(marketplaceMessages.createdAt).limit(20));
    let terkirim = 0;
    for (const { m, c } of antre) {
      if (!c.shopId || !m.text) continue;
      const raw = (m.raw as Obj | null) ?? {};
      const coba = Number(raw.attempts ?? 0) + 1;
      try {
        const mid = await this.sync.kirimPesanChat(userId, c.shopId, c.conversationId, m.text);
        await this.bypass(() => this.db.update(marketplaceMessages)
          .set({ status: "sent", marketplaceMessageId: mid || null, raw: { ...raw, attempts: coba, sentAt: new Date().toISOString() } })
          .where(eq(marketplaceMessages.id, m.id)));
        terkirim++;
      } catch (e) {
        const msg = (e as Error).message ?? "";
        if (/105005/.test(msg)) break; // izin belum aktif: jangan habiskan percobaan
        await this.bypass(() => this.db.update(marketplaceMessages)
          .set({ status: coba >= 5 ? "failed" : "queued", raw: { ...raw, attempts: coba, lastError: msg.slice(0, 300) } })
          .where(eq(marketplaceMessages.id, m.id)));
      }
    }
    return terkirim;
  }

  /* ------------------------------------------------ pemicu */

  private readonly timer = new Map<string, NodeJS.Timeout>();

  /** Dari webhook type 13/14: debounce 5 dtk per seller (pesan beruntun digabung). */
  dariWebhook(userId: string, cid: string | null) {
    const key = `${userId}:${cid ?? ""}`;
    if (this.timer.has(key)) return;
    this.timer.set(key, setTimeout(() => {
      this.timer.delete(key);
      this.jalankan(userId, cid)
        .then((r) => this.logger.log(`chat webhook ${userId}: ${JSON.stringify(r).slice(0, 220)}`))
        .catch((e) => this.logger.warn(`chat webhook gagal: ${(e as Error).message}`));
    }, 5_000));
  }

  /** Jaring pengaman: tiap 10 menit untuk seller yang otomasinya aktif atau punya antrean. */
  @Cron("*/10 * * * *", { timeZone: "Asia/Jakarta" })
  async cron() {
    let users: string[] = [];
    try {
      const a = await this.bypass(() => this.db.select({ id: chatSettings.userId }).from(chatSettings).where(eq(chatSettings.autoReply, true)));
      users = a.map((x) => x.id);
    } catch { /* migrasi belum ada */ }
    try {
      const b = await this.bypass(() => this.db.selectDistinct({ id: marketplaceMessages.userId }).from(marketplaceMessages)
        .where(and(eq(marketplaceMessages.status, "queued"), eq(marketplaceMessages.direction, "out"))));
      users = [...new Set([...users, ...b.map((x) => x.id)])];
    } catch { /* abaikan */ }
    for (const u of users) {
      try { await this.jalankan(u); } catch (e) { this.logger.warn(`chat cron ${u}: ${(e as Error).message}`); }
    }
  }

  /** Dipakai UI "Jalankan sekarang" + dicatat. */
  async jalankanManual(userId: string) {
    const r = await this.jalankan(userId);
    return { ...r, izin: await this.status(userId) };
  }

  /**
   * Uji balasan otomatis TANPA mengirim: contoh pesan pembeli -> jawaban yang
   * akan dikirim bot (KB / pesan luar jam / tidak dibalas). Aman kapan saja.
   */
  async ujiBalasan(userId: string, text: string, orderId?: string) {
    const st = await this.getSettings(userId);
    const d = await this.kb.draft(userId, { text, kind: "chat", orderId });
    if (d.matched) {
      const bolong = /\{(resi|status|pembeli|toko)\}/i.test(d.reply);
      return { akanDibalas: !bolong, sumber: "kb", balasan: d.reply,
        catatan: bolong
          ? "Jawaban KB ini memakai data order ({resi}/{status}/…). Di chat sungguhan diisi dari order terakhir pembeli; bila order tak ketemu, pesan ditahan untuk dijawab manual."
          : (st.autoReply ? null : "Balas otomatis masih MATI — ini hanya pratinjau.") };
    }
    if (st.fallbackText && ChatAutomationService.diLuarJam(st)) {
      return { akanDibalas: true, sumber: "fallback", balasan: st.fallbackText, catatan: "KB tak cocok; sekarang di luar jam kerja." };
    }
    return { akanDibalas: false, sumber: null, balasan: null,
      catatan: "Tidak ada jawaban KB yang cocok — pesan ini akan menunggu dijawab manual. Tambahkan kata kunci di menu Balasan Otomatis (KB)." };
  }

  /** Ringkasan untuk kartu otomasi di UI. */
  async ringkasan(userId: string) {
    const [a] = await this.bypass(() => this.db.select({
      antre: sql<number>`count(*) filter (where ${marketplaceMessages.status} = 'queued')::int`,
      gagal: sql<number>`count(*) filter (where ${marketplaceMessages.status} = 'failed')::int`,
      otomatis: sql<number>`count(*) filter (where ${marketplaceMessages.sender} = 'auto' and ${marketplaceMessages.createdAt} > now() - interval '7 days')::int`,
    }).from(marketplaceMessages).where(eq(marketplaceMessages.userId, userId)));
    return { antre: a?.antre ?? 0, gagal: a?.gagal ?? 0, otomatis7Hari: a?.otomatis ?? 0 };
  }
}
