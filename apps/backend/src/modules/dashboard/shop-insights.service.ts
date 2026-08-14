import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { resiScans, resiScanItems } from "../../database/schema/resi.js";
import { masterProducts } from "../../database/schema/products.js";
import { shopCategories, shops } from "../../database/schema/shops.js";
import { payoutBatches, payoutMutations } from "../../database/schema/payout.js";
import { materialPurchases } from "../../database/schema/products.js";
import { subSellers } from "../../database/schema/payout.js";
import { CostingService } from "../costing/costing.service.js";

/**
 * The questions a person who owns these shops actually asks.
 *
 * Two sources, and they answer different things. Money comes from
 * payout_mutations, because that is what was actually released — an order
 * marked shipped is a promise and a payout is a fact. Movement comes from resi
 * scans, because the marketplace APIs are not connected and the scan is the
 * only record that a parcel really left the building.
 *
 * That split is why the shop mapping on a scan matters: without it, every
 * per-shop figure below can only be built from payouts, which arrive in
 * fortnightly lumps and say nothing about whether a shop shipped anything this
 * week.
 */

/**
 * Student's t, two-sided 95%, by degrees of freedom.
 *
 * Not the normal 1,96. With six days of data the normal approximation states
 * an interval about a quarter too narrow, and a too-narrow interval is worse
 * than none: it converts "we cannot tell yet" into a number that looks settled.
 */
const T95: Record<number, number> = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
  8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145,
  15: 2.131, 16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086,
  21: 2.08, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.06, 26: 2.056,
  27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
};
const t95 = (df: number): number => (df <= 0 ? NaN : df <= 30 ? T95[df]! : 1.96);

/**
 * Effective number of items behind a set of shares — inverse Simpson.
 *
 * Twelve products where one carries 80% is not a catalogue of twelve. This
 * says how many the business behaves as if it had, which is the number that
 * matters when one of them stops selling.
 */
function effectiveCount(values: number[]): number | null {
  const total = values.reduce((n, v) => n + v, 0);
  if (total <= 0) return null;
  const sumSq = values.reduce((n, v) => n + (v / total) ** 2, 0);
  return sumSq > 0 ? Math.round((1 / sumSq) * 10) / 10 : null;
}

export interface ShopInsightsRange {
  from: string;
  to: string;
  days: number;
}

@Injectable()
export class ShopInsightsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly costing: CostingService,
  ) {}

  /**
   * Inclusive day count, so a single-day range divides by 1 rather than 0.
   *
   * "Hari ini" is a real answer here: from and to are the same date and the
   * per-day figures equal the totals, which is what somebody asking about
   * today expects to see.
   */
  private static days(from: string, to: string): number {
    const ms = new Date(to).getTime() - new Date(from).getTime();
    return Math.max(1, Math.round(ms / 86_400_000) + 1);
  }

  private static shiftBack(from: string, to: string): { from: string; to: string } {
    const n = ShopInsightsService.days(from, to);
    const prevTo = new Date(new Date(from).getTime() - 86_400_000);
    const prevFrom = new Date(prevTo.getTime() - (n - 1) * 86_400_000);
    return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
  }

  /**
   * The window, defaulted once.
   *
   * Shared by the overview and the per-shop detail opened from it: two copies
   * of "last 30 days" drift the moment either is edited, and a detail covering
   * a different fortnight from the row that opened it is worse than no detail.
   */
  private resolveRange(from?: string, to?: string) {
    const end = to ?? new Date().toISOString().slice(0, 10);
    const start = from ?? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
    return { from: start, to: end };
  }

  async overview(
    userId: string,
    opts: { from?: string; to?: string; categoryId?: string | null } = {},
  ) {
    const { from, to } = this.resolveRange(opts.from, opts.to);
    const days = ShopInsightsService.days(from, to);
    const prev = ShopInsightsService.shiftBack(from, to);

    // The shops in scope. Category is a filter on this list and nothing else,
    // so every figure below is consistently "these shops" rather than some
    // totals being filtered and others not.
    const shopRows = await this.db
      .select({
        id: shops.id,
        name: sql<string>`coalesce(${shops.displayName}, ${shops.shopName}, '(tanpa nama)')`,
        marketplace: shops.marketplace,
        categoryId: shops.categoryId,
        categoryName: shopCategories.name,
        categoryColor: shopCategories.color,
      })
      .from(shops)
      .leftJoin(shopCategories, eq(shops.categoryId, shopCategories.id))
      .where(
        opts.categoryId
          ? and(eq(shops.userId, userId), eq(shops.categoryId, opts.categoryId))
          : eq(shops.userId, userId),
      );

    const shopIds = shopRows.map((s) => s.id);
    const byId = new Map(shopRows.map((s) => [s.id, s]));

    const [money, moneyPrev, activity, activityPrev, products, owners, restock] = await Promise.all([
      this.moneyByShop(userId, from, to, shopIds),
      this.moneyByShop(userId, prev.from, prev.to, shopIds),
      this.activityByShop(userId, from, to, shopIds),
      this.activityByShop(userId, prev.from, prev.to, shopIds),
      this.topProducts(userId, from, to, shopIds),
      this.ownerEarnings(userId, from, to, shopIds),
      this.restockSpend(userId, from, to),
    ]);

    // Needs the spend, so it runs after rather than beside the rest.
    const vsPublish = await this.materialShareOfPublish(userId, from, to, restock.spend);
    const statistics = await this.statisticalReading(userId, from, to, days);

    const lastShipped = await this.lastShippedByShop(userId, shopIds);
    const today = new Date();

    /**
     * How many different products a shop actually moved.
     *
     * Volume and variety answer different questions: forty parcels of one item
     * is a shop with one hit, forty parcels of twelve items is a shop with a
     * catalogue. Both read as "40 parcels" without this.
     */
    const varietyByShop = new Map<string, number>();
    for (const [shopId, list] of products.byShop) {
      varietyByShop.set(shopId, list.length);
    }

    const perShop = shopRows
      .map((s) => {
        const m = money.get(s.id) ?? { credit: 0, seller: 0, subSeller: 0, subSubSeller: 0 };
        const mPrev = moneyPrev.get(s.id)?.credit ?? 0;
        const a = activity.get(s.id) ?? { parcels: 0, units: 0 };
        const aPrev = activityPrev.get(s.id)?.parcels ?? 0;
        const last = lastShipped.get(s.id) ?? null;

        const idleDays =
          last == null
            ? null
            : Math.floor((today.getTime() - last.getTime()) / 86_400_000);

        /**
         * Said in words, not scored out of a hundred.
         *
         * A composite number would rank shops against each other and explain
         * nothing; what an owner wants to know is whether a shop has stopped,
         * and how long ago.
         */
        const status: "aktif" | "melambat" | "vakum" | "belum ada data" =
          idleDays == null ? "belum ada data" : idleDays <= 7 ? "aktif" : idleDays <= 30 ? "melambat" : "vakum";

        return {
          id: s.id,
          name: s.name,
          marketplace: s.marketplace,
          categoryId: s.categoryId,
          categoryName: s.categoryName,
          categoryColor: s.categoryColor,
          status,
          idleDays,
          lastShippedAt: last,
          credit: m.credit,
          creditPrev: mPrev,
          creditTrendPct: mPrev > 0 ? Math.round(((m.credit - mPrev) / mPrev) * 100) : null,
          creditPerDay: Math.round(m.credit / days),
          sellerShare: m.seller,
          subSellerShare: m.subSeller + m.subSubSeller,
          parcels: a.parcels,
          parcelsPrev: aPrev,
          units: a.units,
          /** Distinct products shipped — variety, not volume. */
          variety: varietyByShop.get(s.id) ?? 0,
          /** What one parcel is worth on average, when both are known. */
          creditPerParcel: a.parcels > 0 ? Math.round(m.credit / a.parcels) : null,
          unitsPerParcel: a.parcels > 0 ? Math.round((a.units / a.parcels) * 10) / 10 : null,
          topProducts: (products.byShop.get(s.id) ?? []).slice(0, 3),
        };
      })
      .sort((a, b) => b.credit - a.credit || b.parcels - a.parcels);

    const totalCredit = perShop.reduce((n, s) => n + s.credit, 0);
    const totalParcels = perShop.reduce((n, s) => n + s.parcels, 0);
    const totalUnits = perShop.reduce((n, s) => n + s.units, 0);

    // Ranked separately on purpose: the shop that ships most is often not the
    // one that earns most, and collapsing them into one "best" hides exactly
    // the case worth looking at — high volume, thin margin.
    const busiest = [...perShop].sort((a, b) => b.parcels - a.parcels)[0] ?? null;
    const richest = perShop[0] ?? null;

    return {
      range: { from, to, days },
      totals: {
        credit: totalCredit,
        creditPerDay: Math.round(totalCredit / days),
        creditPerMonth: Math.round((totalCredit / days) * 30),
        parcels: totalParcels,
        parcelsPerDay: Math.round((totalParcels / days) * 10) / 10,
        units: totalUnits,
        /** Different products moved across every shop in scope. */
        variety: products.overall.length,
        creditPerParcel: totalParcels > 0 ? Math.round(totalCredit / totalParcels) : null,
        unitsPerParcel:
          totalParcels > 0 ? Math.round((totalUnits / totalParcels) * 10) / 10 : null,
        shops: perShop.length,
        activeShops: perShop.filter((s) => s.status === "aktif").length,
        idleShops: perShop.filter((s) => s.status === "vakum").length,
      },
      /**
       * Money in against money out on stock.
       *
       * `spend` counts every purchase in the window regardless of shop, so it
       * does NOT follow the category filter — materials are shared and a
       * per-category split would be invented. The UI says so.
       */
      restock: {
        ...restock,
        /** Positive means more came in than went out on stock. */
        balance: totalCredit - restock.spend,
        /** Spend as a share of what was released, when anything was. */
        shareOfCredit:
          totalCredit > 0 ? Math.round((restock.spend / totalCredit) * 1000) / 10 : null,
        /**
         * Set aside minus spent. Positive is stock money still in hand;
         * negative means buying outran the allowance.
         */
        heldVsSpent: restock.heldForMaterials - restock.spend,
        /**
         * The same spend read against what was shipped, as a share of the
         * listed price — the figure a seller actually budgets against.
         */
        vsPublish,
      },
      /**
       * How much of the rest of this page can be believed.
       *
       * Placed alongside the figures rather than under them: a rate quoted
       * without its spread, or a ranking built on half the parcels, is not a
       * smaller truth — it is a different claim from the one the data supports.
       */
      statistics,
      /** Who took home what, averaged over the range. */
      owners,
      highlights: {
        busiestShop: busiest ? { id: busiest.id, name: busiest.name, parcels: busiest.parcels } : null,
        topEarningShop: richest ? { id: richest.id, name: richest.name, credit: richest.credit } : null,
        topProducts: products.overall.slice(0, 8),
      },
      shops: perShop,
    };
  }

  /**
   * What was actually paid for stock in the window, and what was set aside.
   *
   * Deliberately NOT filtered by shop or category. Materials are bought once
   * and used by every product across every shop — there is no honest way to
   * attribute a drum of glycerine to one of them, and a per-shop figure here
   * would be an invented split presented as a fact.
   */
  private async restockSpend(userId: string, from: string, to: string) {
    const [spend] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${materialPurchases.totalCost}), 0)`,
        count: sql<number>`count(*)::int`,
        // A delivery scanned without a COD amount has no price to record. The
        // spend is a floor, and saying how many are missing is the difference
        // between a figure and a guess.
        unpriced: sql<number>`count(*) filter (where coalesce(${materialPurchases.totalCost}, '0')::numeric <= 0)::int`,
      })
      .from(materialPurchases)
      .where(
        and(
          eq(materialPurchases.userId, userId),
          gte(materialPurchases.purchasedAt, from),
          lte(materialPurchases.purchasedAt, to),
        ),
      );

    // What the payout split held back for materials. A different thing from
    // what was spent, and the gap is the point.
    const [held] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${payoutMutations.sellerMaterialAmount}), 0)`,
      })
      .from(payoutMutations)
      .where(
        and(
          eq(payoutMutations.userId, userId),
          gte(payoutMutations.payoutDate, from),
          lte(payoutMutations.payoutDate, to),
        ),
      );

    return {
      spend: Number(spend?.total ?? 0),
      purchases: Number(spend?.count ?? 0),
      unpricedPurchases: Number(spend?.unpriced ?? 0),
      heldForMaterials: Number(held?.total ?? 0),
    };
  }

  /**
   * One shop, parcel by parcel.
   *
   * The health table answers "which shops are moving"; this answers "moving
   * what, exactly, and when". Those are different questions and the second one
   * cannot be aggregated — an owner checking a shop wants the individual
   * parcels, with the time on each, because that is what they can compare
   * against the marketplace's own order list.
   *
   * Scans with no shop mapped cannot appear here by definition. The count of
   * them is returned so the page can say how much of the shop's real traffic
   * this list is likely to be missing, rather than presenting a partial list
   * as a complete one.
   */
  async shopDetail(
    userId: string,
    shopId: string,
    opts: { from?: string; to?: string } = {},
  ) {
    const { from, to } = this.resolveRange(opts.from, opts.to);
    const lo = new Date(from + "T00:00:00Z");
    const hi = new Date(to + "T23:59:59Z");

    const [shop] = await this.db
      .select({
        id: shops.id,
        name: sql<string>`coalesce(${shops.displayName}, ${shops.shopName}, '(tanpa nama)')`,
        marketplace: shops.marketplace,
        categoryName: shopCategories.name,
      })
      .from(shops)
      .leftJoin(shopCategories, eq(shops.categoryId, shopCategories.id))
      .where(and(eq(shops.id, shopId), eq(shops.userId, userId)))
      .limit(1);
    if (!shop) throw new NotFoundException("Toko tidak ditemukan");

    const scanRows = await this.db
      .select({
        id: resiScans.id,
        resi: resiScans.resi,
        scannedAt: resiScans.scannedAt,
        // The confirmed value wins over the guess; the guess is still shown
        // when nobody has confirmed, marked as such.
        courier: resiScans.courier,
        courierConfirmed: resiScans.courierConfirmed,
        marketplace: resiScans.marketplace,
        photoUrl: resiScans.photoUrl,
        mappingConfirmedAt: resiScans.mappingConfirmedAt,
        itemsConfirmedAt: resiScans.itemsConfirmedAt,
        recipient: resiScans.labelRecipient,
        recipientArea: resiScans.labelRecipientArea,
        service: resiScans.labelService,
        weightKg: resiScans.labelWeightKg,
        cod: resiScans.labelCod,
      })
      .from(resiScans)
      .where(
        and(
          eq(resiScans.userId, userId),
          eq(resiScans.shopId, shopId),
          gte(resiScans.scannedAt, lo),
          lte(resiScans.scannedAt, hi),
        ),
      )
      .orderBy(desc(resiScans.scannedAt));

    const scanIds = scanRows.map((s) => s.id);
    const itemRows = scanIds.length
      ? await this.db
          .select({
            scanId: resiScanItems.resiScanId,
            name: masterProducts.name,
            rawName: resiScanItems.rawName,
            qty: resiScanItems.qty,
            source: resiScanItems.source,
          })
          .from(resiScanItems)
          .leftJoin(masterProducts, eq(resiScanItems.masterProductId, masterProducts.id))
          .where(inArray(resiScanItems.resiScanId, scanIds))
      : [];

    const itemsByScan = new Map<string, { name: string; qty: number; guessed: boolean }[]>();
    for (const r of itemRows) {
      const arr = itemsByScan.get(r.scanId) ?? [];
      arr.push({
        // The mapped product is the answer; the raw OCR text is the fallback,
        // and saying which one is on screen matters when it is wrong.
        name: r.name ?? r.rawName ?? "(belum dipetakan)",
        qty: Number(r.qty),
        guessed: r.name == null,
      });
      itemsByScan.set(r.scanId, arr);
    }

    const scans = scanRows.map((s) => {
      const items = itemsByScan.get(s.id) ?? [];
      return {
        id: s.id,
        resi: s.resi,
        scannedAt: s.scannedAt,
        courier: s.courierConfirmed ?? s.courier ?? null,
        courierConfirmed: s.courierConfirmed != null,
        marketplace: s.marketplace,
        photoUrl: s.photoUrl,
        mappingConfirmed: s.mappingConfirmedAt != null,
        itemsConfirmed: s.itemsConfirmedAt != null,
        recipient: s.recipient,
        recipientArea: s.recipientArea,
        service: s.service,
        weightKg: s.weightKg != null ? Number(s.weightKg) : null,
        cod: s.cod,
        items,
        units: items.reduce((n, i) => n + i.qty, 0),
      };
    });

    const payouts = await this.db
      .select({
        payoutDate: payoutMutations.payoutDate,
        credit: sql<string>`coalesce(sum(${payoutMutations.creditAmount}), 0)`,
        seller: sql<string>`coalesce(sum(${payoutMutations.sellerAmount}), 0)`,
        subSeller: sql<string>`coalesce(sum(${payoutMutations.subSellerAmount} + ${payoutMutations.subSubSellerAmount}), 0)`,
        rows: sql<number>`count(*)::int`,
      })
      .from(payoutMutations)
      .where(
        and(
          eq(payoutMutations.userId, userId),
          eq(payoutMutations.shopId, shopId),
          gte(payoutMutations.payoutDate, from),
          lte(payoutMutations.payoutDate, to),
        ),
      )
      .groupBy(payoutMutations.payoutDate)
      .orderBy(desc(payoutMutations.payoutDate));

    // How much of this shop's traffic the list above can even see. An owner
    // comparing it against the marketplace's order count deserves to know
    // before they conclude parcels went missing.
    const [unmapped] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(resiScans)
      .where(
        and(
          eq(resiScans.userId, userId),
          isNull(resiScans.shopId),
          gte(resiScans.scannedAt, lo),
          lte(resiScans.scannedAt, hi),
        ),
      );

    return {
      shop,
      range: { from, to },
      totals: {
        parcels: scans.length,
        units: scans.reduce((n, s) => n + s.units, 0),
        credit: payouts.reduce((n, p) => n + Number(p.credit), 0),
        seller: payouts.reduce((n, p) => n + Number(p.seller), 0),
        subSeller: payouts.reduce((n, p) => n + Number(p.subSeller), 0),
        unconfirmedItems: scans.filter((s) => !s.itemsConfirmed).length,
      },
      scans,
      payouts: payouts.map((p) => ({
        payoutDate: p.payoutDate,
        credit: Number(p.credit),
        seller: Number(p.seller),
        subSeller: Number(p.subSeller),
        rows: p.rows,
      })),
      /** Parcels in this window with no shop at all — not this shop's, but not ruled out either. */
      unmappedInWindow: Number(unmapped?.n ?? 0),
    };
  }

  /**
   * The reading a statistician would insist on before any of the rest is used.
   *
   * Three questions, in order of how badly getting them wrong misleads:
   *
   * 1. How much data is there, and over what span? A rate divided by the
   *    calendar window rather than by the days the business was actually
   *    running understates it by however much of the window came before the
   *    first parcel. Both are reported, labelled.
   *
   * 2. How much does it vary? The daily counts here run 5 to 25, which is far
   *    more spread than a Poisson process would give — packing happens in
   *    batches, not at a steady trickle. So the interval is built from the
   *    observed day-to-day variation with a t multiplier, not from sqrt(n).
   *    Assuming Poisson would state an interval roughly a third as wide and
   *    make a guess look like a measurement.
   *
   * 3. How complete is it? Per-shop figures can only see parcels that have a
   *    shop mapped. Ranking nine shops on 43% of parcels is not a ranking.
   */
  private async statisticalReading(
    userId: string,
    from: string,
    to: string,
    windowDays: number,
  ) {
    const day = sql<string>`(${resiScans.scannedAt} at time zone 'Asia/Jakarta')::date`;
    const lo = new Date(from + "T00:00:00Z");
    const hi = new Date(to + "T23:59:59Z");
    const inWindow = and(
      eq(resiScans.userId, userId),
      gte(resiScans.scannedAt, lo),
      lte(resiScans.scannedAt, hi),
    );

    const [dailyRows, coverRow, productRows, shopRows] = await Promise.all([
      this.db
        .select({
          date: day,
          parcels: sql<number>`count(distinct ${resiScans.id})::int`,
          units: sql<string>`coalesce(sum(${resiScanItems.qty}), 0)`,
        })
        .from(resiScans)
        .leftJoin(resiScanItems, eq(resiScanItems.resiScanId, resiScans.id))
        .where(inWindow)
        .groupBy(day)
        .orderBy(day),
      // Joined rather than an EXISTS subquery. The subquery form returned
      // zero for every scan while a plain join over the same two tables
      // returned 74 of 75 -- a correlated raw-SQL reference that reads as
      // valid and quietly matches nothing. Counting distinct scan ids keeps
      // the join from multiplying a parcel by its number of lines.
      this.db
        .select({
          scans: sql<number>`count(distinct ${resiScans.id})::int`,
          withShop: sql<number>`count(distinct ${resiScans.id}) filter (where ${resiScans.shopId} is not null)::int`,
          withCourier: sql<number>`count(distinct ${resiScans.id}) filter (where coalesce(${resiScans.courier}, '') <> '')::int`,
          withMarketplace: sql<number>`count(distinct ${resiScans.id}) filter (where coalesce(${resiScans.marketplace}, '') <> '')::int`,
          withItems: sql<number>`count(distinct ${resiScans.id}) filter (where ${resiScanItems.id} is not null)::int`,
        })
        .from(resiScans)
        .leftJoin(resiScanItems, eq(resiScanItems.resiScanId, resiScans.id))
        .where(inWindow),
      this.db
        .select({
          name: masterProducts.name,
          units: sql<string>`coalesce(sum(${resiScanItems.qty}), 0)`,
        })
        .from(resiScanItems)
        .innerJoin(resiScans, eq(resiScanItems.resiScanId, resiScans.id))
        .innerJoin(masterProducts, eq(resiScanItems.masterProductId, masterProducts.id))
        .where(inWindow)
        .groupBy(masterProducts.name),
      this.db
        .select({
          shopId: resiScans.shopId,
          parcels: sql<number>`count(distinct ${resiScans.id})::int`,
        })
        .from(resiScans)
        .where(inWindow)
        .groupBy(resiScans.shopId),
    ]);

    const cover = coverRow[0] ?? {
      scans: 0, withShop: 0, withCourier: 0, withMarketplace: 0, withItems: 0,
    };
    const pct = (part: number, whole: number) =>
      whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

    /**
     * Zero-filled from the first active day to the last.
     *
     * Days inside the span with nothing shipped are real zeros and belong in
     * the average. Days before the first parcel are not — the business was not
     * running, and including them measures the calendar rather than the shop.
     */
    const observed = dailyRows.map((r) => ({
      date: String(r.date),
      parcels: Number(r.parcels),
      units: Number(r.units),
    }));
    const daily: { date: string; parcels: number; units: number }[] = [];
    if (observed.length) {
      const byDate = new Map(observed.map((d) => [d.date, d]));
      const first = new Date(observed[0]!.date + "T00:00:00Z");
      const last = new Date(observed[observed.length - 1]!.date + "T00:00:00Z");
      for (let t = first.getTime(); t <= last.getTime(); t += 86_400_000) {
        const key = new Date(t).toISOString().slice(0, 10);
        daily.push(byDate.get(key) ?? { date: key, parcels: 0, units: 0 });
      }
    }

    const spanDays = daily.length;
    const activeDays = observed.length;
    const parcels = daily.reduce((n, d) => n + d.parcels, 0);
    const units = daily.reduce((n, d) => n + d.units, 0);

    /** Mean and spread of the daily count, and what that implies for the rate. */
    let perDay: number | null = null;
    let perDayLow: number | null = null;
    let perDayHigh: number | null = null;
    let dispersion: number | null = null;
    if (spanDays > 0) {
      perDay = Math.round((parcels / spanDays) * 10) / 10;
      if (spanDays > 1) {
        const mean = parcels / spanDays;
        const variance =
          daily.reduce((n, d) => n + (d.parcels - mean) ** 2, 0) / (spanDays - 1);
        const stderr = Math.sqrt(variance / spanDays);
        const margin = t95(spanDays - 1) * stderr;
        perDayLow = Math.max(0, Math.round((mean - margin) * 10) / 10);
        perDayHigh = Math.round((mean + margin) * 10) / 10;
        // Above ~1,5 the days are clumpy rather than steady, which is the
        // signal that a single day tells you very little about the next.
        dispersion = mean > 0 ? Math.round((variance / mean) * 10) / 10 : null;
      }
    }

    const productUnits = productRows.map((r) => Number(r.units)).filter((n) => n > 0);
    const topProduct = productRows
      .map((r) => ({ name: r.name, units: Number(r.units) }))
      .sort((a, b) => b.units - a.units)[0] ?? null;
    const totalProductUnits = productUnits.reduce((n, v) => n + v, 0);

    const mappedShops = shopRows
      .filter((r) => r.shopId)
      .map((r) => Number(r.parcels))
      .filter((n) => n > 0)
      .sort((a, b) => b - a);

    /**
     * Two counts are only different if the gap outruns the noise in both.
     *
     * The standard two-sample comparison for counts: |a-b| against
     * 1,96*sqrt(a+b). Sixteen parcels against twelve looks like a clear winner
     * and is not — the gap is four and the noise is ten.
     */
    const topTwoDistinguishable =
      mappedShops.length >= 2
        ? Math.abs(mappedShops[0]! - mappedShops[1]!) >
          1.96 * Math.sqrt(mappedShops[0]! + mappedShops[1]!)
        : null;

    return {
      span: {
        firstDay: daily[0]?.date ?? null,
        lastDay: daily[daily.length - 1]?.date ?? null,
        spanDays,
        activeDays,
        windowDays,
        parcels,
        units,
      },
      coverage: {
        scans: cover.scans,
        withShop: cover.withShop,
        withCourier: cover.withCourier,
        withMarketplace: cover.withMarketplace,
        withItems: cover.withItems,
        shopPct: pct(cover.withShop, cover.scans),
        courierPct: pct(cover.withCourier, cover.scans),
        marketplacePct: pct(cover.withMarketplace, cover.scans),
        itemsPct: pct(cover.withItems, cover.scans),
      },
      rate: {
        /** Over the days the business was actually running. */
        parcelsPerDay: perDay,
        parcelsPerDayLow: perDayLow,
        parcelsPerDayHigh: perDayHigh,
        unitsPerDay: spanDays > 0 ? Math.round((units / spanDays) * 10) / 10 : null,
        /** The same parcels spread over the whole selected window, for contrast. */
        parcelsPerWindowDay:
          windowDays > 0 ? Math.round((parcels / windowDays) * 10) / 10 : null,
        dispersion,
        monthlyLow: perDayLow != null ? Math.round(perDayLow * 30) : null,
        monthlyMid: perDay != null ? Math.round(perDay * 30) : null,
        monthlyHigh: perDayHigh != null ? Math.round(perDayHigh * 30) : null,
      },
      concentration: {
        topProductName: topProduct?.name ?? null,
        topProductSharePct: topProduct ? pct(topProduct.units, totalProductUnits) : null,
        effectiveProducts: effectiveCount(productUnits),
        distinctProducts: productUnits.length,
        effectiveShops: effectiveCount(mappedShops),
        mappedShops: mappedShops.length,
        topTwoDistinguishable,
      },
      daily,
    };
  }

  /**
   * What stock buying comes to as a share of the listed price.
   *
   * Two figures side by side. The plan is what the recipes say a shipped unit
   * should consume; the reality is what was actually paid for stock in the
   * same window. A seller who budgeted 25% of the publish price for materials
   * has no way to check that today — the recipes say one thing, the bank says
   * another, and nothing puts them on the same axis.
   *
   * Deliberately NOT filtered by shop or category, for the same reason the
   * spend is not: materials are bought once and used everywhere. Dividing a
   * whole-business spend by one category's sales would invent a number.
   *
   * The honest caveat, which the page repeats: buying is lumpy and consumption
   * is smooth. Six kilos of glycerine bought in one week are used over three
   * months, so a short window says more about when an order was placed than
   * about how much a product really eats. It is a long-range reading.
   */
  private async materialShareOfPublish(
    userId: string,
    from: string,
    to: string,
    spend: number,
  ) {
    const [unitRows, perPcs] = await Promise.all([
      this.db
        .select({
          productId: resiScanItems.masterProductId,
          units: sql<string>`coalesce(sum(${resiScanItems.qty}), 0)`,
        })
        .from(resiScanItems)
        .innerJoin(resiScans, eq(resiScanItems.resiScanId, resiScans.id))
        .where(
          and(
            eq(resiScans.userId, userId),
            gte(resiScans.scannedAt, new Date(from + "T00:00:00Z")),
            lte(resiScans.scannedAt, new Date(to + "T23:59:59Z")),
          ),
        )
        .groupBy(resiScanItems.masterProductId),
      this.costing.materialCostPerProduct(userId),
    ]);

    const byId = new Map(perPcs.map((p) => [p.id, p]));
    let publishValue = 0;
    let plannedRecipe = 0;
    let plannedPacking = 0;
    let units = 0;
    let unitsNoPrice = 0;
    let unitsNoRecipe = 0;
    let productsMissingCost = 0;
    const perProduct: {
      id: string;
      name: string;
      units: number;
      publishPrice: number;
      materialPerPcs: number;
      packingMaterialPerPcs: number;
      pct: number;
    }[] = [];

    for (const r of unitRows) {
      if (!r.productId) continue;
      const qty = Number(r.units);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const c = byId.get(r.productId);
      if (!c) continue;
      // A unit with no listed price cannot be expressed as a share of one.
      // Counted and reported rather than folded in at zero, which would drag
      // the whole percentage up and look like overspending.
      if (c.publishPrice == null) {
        unitsNoPrice += qty;
        continue;
      }
      units += qty;
      publishValue += qty * c.publishPrice;
      plannedRecipe += qty * c.materialPerPcs;
      plannedPacking += qty * c.packingMaterialPerPcs;
      if (c.recipeLines === 0) unitsNoRecipe += qty;
      if (c.missingCost) productsMissingCost++;
      const per = c.materialPerPcs + c.packingMaterialPerPcs;
      perProduct.push({
        id: c.id,
        name: c.name,
        units: qty,
        publishPrice: c.publishPrice,
        materialPerPcs: Math.round(c.materialPerPcs),
        packingMaterialPerPcs: Math.round(c.packingMaterialPerPcs),
        pct: Math.round((per / c.publishPrice) * 1000) / 10,
      });
    }

    const share = (part: number, whole: number) =>
      whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

    const plannedPct = share(plannedRecipe + plannedPacking, publishValue);
    const actualPct = share(spend, publishValue);

    // Heaviest first: the point of the list is which products to look at, and
    // that is never the ones sitting comfortably under the budget.
    perProduct.sort((a, b) => b.pct - a.pct || b.units - a.units);

    /**
     * Above 100% the product costs more in materials than it sells for, which
     * is never a costing insight — it is a wrong price or a wrong recipe. Kept
     * out of the ranking and named instead.
     *
     * Found on real data: a product carrying a base price of Rp 32,55 scored
     * 6.605% and sat at the top of the list, pushing every product actually
     * worth looking at off the screen.
     */
    const needsReview = perProduct.filter((p) => p.pct > 100);
    const ranked = perProduct.filter((p) => p.pct <= 100);

    return {
      publishValue: Math.round(publishValue),
      units,
      unitsNoPrice,
      unitsNoRecipe,
      productsMissingCost,
      plannedRecipe: Math.round(plannedRecipe),
      plannedPacking: Math.round(plannedPacking),
      plannedPct,
      plannedRecipePct: share(plannedRecipe, publishValue),
      plannedPackingPct: share(plannedPacking, publishValue),
      actualPct,
      /** Positive means buying outran the recipe, in percentage points. */
      gapPct:
        plannedPct != null && actualPct != null
          ? Math.round((actualPct - plannedPct) * 10) / 10
          : null,
      perProduct: ranked.slice(0, 12),
      /** Priced below what their own materials cost — a data fix, not a ratio. */
      needsReview: needsReview.slice(0, 8),
      needsReviewCount: needsReview.length,
    };
  }

  /** Money released per shop, from the payout ledger rather than from orders. */
  private async moneyByShop(userId: string, from: string, to: string, shopIds: string[]) {
    const out = new Map<string, { credit: number; seller: number; subSeller: number; subSubSeller: number }>();
    if (!shopIds.length) return out;

    const rows = await this.db
      .select({
        shopId: payoutMutations.shopId,
        credit: sql<string>`coalesce(sum(${payoutMutations.creditAmount}), 0)`,
        seller: sql<string>`coalesce(sum(${payoutMutations.sellerAmount}), 0)`,
        subSeller: sql<string>`coalesce(sum(${payoutMutations.subSellerAmount}), 0)`,
        subSubSeller: sql<string>`coalesce(sum(${payoutMutations.subSubSellerAmount}), 0)`,
      })
      .from(payoutMutations)
      .innerJoin(payoutBatches, eq(payoutMutations.batchId, payoutBatches.id))
      .where(
        and(
          eq(payoutMutations.userId, userId),
          inArray(payoutMutations.shopId, shopIds),
          gte(payoutMutations.payoutDate, from),
          lte(payoutMutations.payoutDate, to),
        ),
      )
      .groupBy(payoutMutations.shopId);

    for (const r of rows) {
      if (!r.shopId) continue;
      out.set(r.shopId, {
        credit: Number(r.credit),
        seller: Number(r.seller),
        subSeller: Number(r.subSeller),
        subSubSeller: Number(r.subSubSeller),
      });
    }
    return out;
  }

  /**
   * Parcels and units shipped per shop, from scans.
   *
   * Only mapped scans can appear here, which is the whole reason the pending
   * task about unmapped scans is worth chasing: an unmapped parcel is invisible
   * to every figure in this column.
   */
  private async activityByShop(userId: string, from: string, to: string, shopIds: string[]) {
    const out = new Map<string, { parcels: number; units: number }>();
    if (!shopIds.length) return out;

    const rows = await this.db
      .select({
        shopId: resiScans.shopId,
        parcels: sql<number>`count(distinct ${resiScans.id})::int`,
        units: sql<string>`coalesce(sum(${resiScanItems.qty}), 0)`,
      })
      .from(resiScans)
      .leftJoin(resiScanItems, eq(resiScanItems.resiScanId, resiScans.id))
      .where(
        and(
          eq(resiScans.userId, userId),
          inArray(resiScans.shopId, shopIds),
          gte(resiScans.scannedAt, new Date(from + "T00:00:00Z")),
          lte(resiScans.scannedAt, new Date(to + "T23:59:59Z")),
        ),
      )
      .groupBy(resiScans.shopId);

    for (const r of rows) {
      if (!r.shopId) continue;
      out.set(r.shopId, { parcels: Number(r.parcels), units: Number(r.units) });
    }
    return out;
  }

  /** When each shop last shipped anything at all — the basis for "vakum". */
  private async lastShippedByShop(userId: string, shopIds: string[]) {
    const out = new Map<string, Date>();
    if (!shopIds.length) return out;
    const rows = await this.db
      .select({ shopId: resiScans.shopId, last: sql<string>`max(${resiScans.scannedAt})` })
      .from(resiScans)
      .where(and(eq(resiScans.userId, userId), inArray(resiScans.shopId, shopIds)))
      .groupBy(resiScans.shopId);
    for (const r of rows) {
      if (r.shopId && r.last) out.set(r.shopId, new Date(r.last));
    }
    return out;
  }

  /** What actually shipped, overall and per shop. */
  private async topProducts(userId: string, from: string, to: string, shopIds: string[]) {
    const empty = { overall: [] as { id: string; name: string; units: number; parcels: number }[], byShop: new Map<string, { id: string; name: string; units: number }[]>() };
    if (!shopIds.length) return empty;

    const rows = await this.db
      .select({
        shopId: resiScans.shopId,
        productId: resiScanItems.masterProductId,
        name: masterProducts.name,
        units: sql<string>`coalesce(sum(${resiScanItems.qty}), 0)`,
        parcels: sql<number>`count(distinct ${resiScans.id})::int`,
      })
      .from(resiScanItems)
      .innerJoin(resiScans, eq(resiScanItems.resiScanId, resiScans.id))
      .innerJoin(masterProducts, eq(resiScanItems.masterProductId, masterProducts.id))
      .where(
        and(
          eq(resiScans.userId, userId),
          inArray(resiScans.shopId, shopIds),
          gte(resiScans.scannedAt, new Date(from + "T00:00:00Z")),
          lte(resiScans.scannedAt, new Date(to + "T23:59:59Z")),
        ),
      )
      .groupBy(resiScans.shopId, resiScanItems.masterProductId, masterProducts.name);

    const byShop = new Map<string, { id: string; name: string; units: number }[]>();
    const overallMap = new Map<string, { id: string; name: string; units: number; parcels: number }>();

    for (const r of rows) {
      if (!r.productId) continue;
      const units = Number(r.units);
      if (r.shopId) {
        const arr = byShop.get(r.shopId) ?? [];
        arr.push({ id: r.productId, name: r.name, units });
        byShop.set(r.shopId, arr);
      }
      const o = overallMap.get(r.productId) ?? { id: r.productId, name: r.name, units: 0, parcels: 0 };
      o.units += units;
      o.parcels += Number(r.parcels);
      overallMap.set(r.productId, o);
    }

    for (const [k, v] of byShop) byShop.set(k, v.sort((a, b) => b.units - a.units));

    return {
      overall: [...overallMap.values()].sort((a, b) => b.units - a.units),
      byShop,
    };
  }

  /**
   * What each person earned across the range, and per day.
   *
   * The seller is one row because there is one; sub-sellers are named, because
   * "sub-seller earnings" as a single number answers nobody's question about
   * which of them is actually selling.
   */
  private async ownerEarnings(userId: string, from: string, to: string, shopIds: string[]) {
    const days = ShopInsightsService.days(from, to);
    if (!shopIds.length) {
      return { seller: { total: 0, perDay: 0, perMonth: 0 }, subSellers: [] };
    }

    const [totals] = await this.db
      .select({
        seller: sql<string>`coalesce(sum(${payoutMutations.sellerAmount}), 0)`,
      })
      .from(payoutMutations)
      .where(
        and(
          eq(payoutMutations.userId, userId),
          inArray(payoutMutations.shopId, shopIds),
          gte(payoutMutations.payoutDate, from),
          lte(payoutMutations.payoutDate, to),
        ),
      );

    const subs = await this.db
      .select({
        id: payoutMutations.subSellerId,
        name: subSellers.name,
        total: sql<string>`coalesce(sum(${payoutMutations.subSellerAmount} + ${payoutMutations.subSubSellerAmount}), 0)`,
      })
      .from(payoutMutations)
      .leftJoin(subSellers, eq(payoutMutations.subSellerId, subSellers.id))
      .where(
        and(
          eq(payoutMutations.userId, userId),
          inArray(payoutMutations.shopId, shopIds),
          gte(payoutMutations.payoutDate, from),
          lte(payoutMutations.payoutDate, to),
        ),
      )
      .groupBy(payoutMutations.subSellerId, subSellers.name);

    const sellerTotal = Number(totals?.seller ?? 0);

    return {
      seller: {
        total: sellerTotal,
        perDay: Math.round(sellerTotal / days),
        perMonth: Math.round((sellerTotal / days) * 30),
      },
      subSellers: subs
        .filter((s) => s.id)
        .map((s) => ({
          id: s.id!,
          name: s.name ?? "(tanpa nama)",
          total: Number(s.total),
          perDay: Math.round(Number(s.total) / days),
          perMonth: Math.round((Number(s.total) / days) * 30),
        }))
        .sort((a, b) => b.total - a.total),
    };
  }
}
