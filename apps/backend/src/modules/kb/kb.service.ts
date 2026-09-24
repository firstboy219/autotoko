import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { kbEntries, orders, shops } from "../../database/schema/index.js";

type KbKind = "chat" | "review";
const kindOf = (k?: string): KbKind => (k === "review" ? "review" : "chat");

/**
 * "AI internal": pencocokan kata kunci lokal atas KB seller (tanpa API vendor).
 *
 * list/match dibungkus try/catch supaya aman dipanggil sebelum migrasi tabel
 * dijalankan (balik kosong/null, bukan error). Tenancy dijaga filter user_id.
 */
@Injectable()
export class KbService {
  private readonly logger = new Logger(KbService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(userId: string, kind?: string) {
    try {
      const where = kind
        ? and(eq(kbEntries.userId, userId), eq(kbEntries.kind, kindOf(kind)))
        : eq(kbEntries.userId, userId);
      return await this.db
        .select()
        .from(kbEntries)
        .where(where)
        .orderBy(desc(kbEntries.priority), desc(kbEntries.updatedAt));
    } catch (e) {
      this.logger.warn(`kb list: ${(e as Error).message}`);
      return [];
    }
  }

  async create(
    userId: string,
    dto: { kind?: string; keywords: string; answer: string; priority?: number; active?: boolean },
  ) {
    const [row] = await this.db
      .insert(kbEntries)
      .values({
        userId,
        kind: kindOf(dto.kind),
        keywords: dto.keywords,
        answer: dto.answer,
        priority: dto.priority ?? 0,
        active: dto.active ?? true,
      })
      .returning();
    return row;
  }

  async update(
    userId: string,
    id: string,
    dto: { kind?: string; keywords?: string; answer?: string; priority?: number; active?: boolean },
  ) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.kind !== undefined) set.kind = kindOf(dto.kind);
    if (dto.keywords !== undefined) set.keywords = dto.keywords;
    if (dto.answer !== undefined) set.answer = dto.answer;
    if (dto.priority !== undefined) set.priority = dto.priority;
    if (dto.active !== undefined) set.active = dto.active;
    const [row] = await this.db
      .update(kbEntries)
      .set(set)
      .where(and(eq(kbEntries.id, id), eq(kbEntries.userId, userId)))
      .returning();
    return row;
  }

  async remove(userId: string, id: string) {
    await this.db.delete(kbEntries).where(and(eq(kbEntries.id, id), eq(kbEntries.userId, userId)));
    return { id };
  }

  private norm(s: string): string[] {
    return (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2);
  }

  /** Entri KB paling cocok untuk sebuah teks (skor overlap kata kunci). */
  async match(userId: string, text: string, kind: KbKind = "chat") {
    try {
      const entries = await this.db
        .select()
        .from(kbEntries)
        .where(and(eq(kbEntries.userId, userId), eq(kbEntries.kind, kind), eq(kbEntries.active, true)));
      if (!entries.length) return null;
      const words = new Set(this.norm(text));
      let best: { entry: (typeof entries)[number]; score: number } | null = null;
      for (const e of entries) {
        const kws = this.norm(e.keywords);
        if (!kws.length) continue;
        let hit = 0;
        for (const k of kws) if (words.has(k)) hit++;
        if (hit === 0) continue;
        // Rasio kata kunci yang cocok + priority sebagai pemecah seri.
        const score = hit / kws.length + e.priority / 1000;
        if (!best || score > best.score) best = { entry: e, score };
      }
      // Ambang: minimal separuh kata kunci entri cocok.
      return best && best.score >= 0.5 ? best.entry : null;
    } catch (e) {
      this.logger.warn(`kb match: ${(e as Error).message}`);
      return null;
    }
  }

  /** Susun draf balasan dari KB, isi placeholder dari order bila ada. */
  async draft(userId: string, input: { text: string; kind?: string; orderId?: string }) {
    const entry = await this.match(userId, input.text, kindOf(input.kind));
    if (!entry) return { matched: false, reply: "" };
    let reply = entry.answer;
    if (input.orderId && /\{(resi|status|pembeli|toko)\}/i.test(reply)) {
      try {
        const [o] = await this.db
          .select({
            resi: orders.trackingNumber,
            status: orders.fulfillmentStatus,
            pembeli: orders.buyerName,
            shopId: orders.shopId,
          })
          .from(orders)
          .where(and(eq(orders.id, input.orderId), eq(orders.userId, userId)))
          .limit(1);
        if (o) {
          let toko = "";
          if (o.shopId) {
            const [s] = await this.db
              .select({ n: sql<string>`coalesce(${shops.displayName}, ${shops.shopName})` })
              .from(shops)
              .where(eq(shops.id, o.shopId))
              .limit(1);
            toko = String(s?.n ?? "");
          }
          reply = reply
            .replace(/\{resi\}/gi, o.resi ?? "-")
            .replace(/\{status\}/gi, o.status ?? "-")
            .replace(/\{pembeli\}/gi, o.pembeli ?? "-")
            .replace(/\{toko\}/gi, toko || "-");
        }
      } catch {
        /* biarkan placeholder apa adanya bila order tak terbaca */
      }
    }
    return { matched: true, reply, entryId: entry.id };
  }
}
