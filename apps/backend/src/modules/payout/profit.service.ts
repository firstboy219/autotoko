import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  payoutBatches,
  payoutMutations,
  shops,
  subSellers,
  subSubSellers,
} from "../../database/schema/index.js";

/**
 * What the payout ledger says each party ended up with.
 *
 * A deliberate name: this reports the seller's TAKE, not their profit. Profit
 * needs what the goods cost, and nothing in a payout row says which goods were
 * in it — payout_mutations carries an order_ref_ids column that is empty on
 * every row recorded so far, so there is no path from a payout to a product to
 * its HPP. Reporting "profit" from this data would mean quietly presenting
 * revenue-after-commission as though the cost of goods were zero, which is the
 * one number a seller must not be given wrong.
 *
 * What it CAN answer, exactly, because every figure was frozen into the
 * mutation when it was recorded: how much came in, how it was split, what each
 * sub-seller earned, which shops produced it, and how that moved month to
 * month.
 */
@Injectable()
export class PayoutProfitService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * A tenant's payouts are bounded by shops times payout days, so a year of
   * a busy seller is low thousands of rows. Aggregating those in one pass here
   * keeps the money arithmetic in a single place; four SQL GROUP BYs would
   * mean four chances for the definition of "seller net" to drift apart.
   */
  private static readonly MAX_ROWS = 20_000;

  async report(
    userId: string,
    opts: { from?: string; to?: string; onlySettled?: boolean } = {},
  ) {
    const conds = [eq(payoutMutations.userId, userId)];
    if (opts.from) conds.push(gte(payoutMutations.payoutDate, opts.from));
    if (opts.to) conds.push(lte(payoutMutations.payoutDate, opts.to));
    // "Settled" means the batch was closed out, not that the row exists. An
    // open batch is a work in progress and counting it as earnings would make
    // every report change under the reader as the day went on.
    if (opts.onlySettled) conds.push(eq(payoutBatches.status, "selesai"));

    const rows = await this.db
      .select({
        mutationId: payoutMutations.id,
        batchId: payoutMutations.batchId,
        batchStatus: payoutBatches.status,
        payoutDate: payoutMutations.payoutDate,
        credit: payoutMutations.creditAmount,
        sedekah: payoutMutations.sedekahAmount,
        seller: payoutMutations.sellerAmount,
        material: payoutMutations.sellerMaterialAmount,
        subSeller: payoutMutations.subSellerAmount,
        subSubSeller: payoutMutations.subSubSellerAmount,
        shopId: payoutMutations.shopId,
        shopName: shops.displayName,
        shopFallback: shops.shopName,
        marketplace: shops.marketplace,
        subSellerId: payoutMutations.subSellerId,
        subSellerName: subSellers.name,
        subSubSellerId: payoutMutations.subSubSellerId,
        subSubSellerName: subSubSellers.name,
      })
      .from(payoutMutations)
      .leftJoin(payoutBatches, eq(payoutMutations.batchId, payoutBatches.id))
      .leftJoin(shops, eq(payoutMutations.shopId, shops.id))
      .leftJoin(subSellers, eq(payoutMutations.subSellerId, subSellers.id))
      .leftJoin(subSubSellers, eq(payoutMutations.subSubSellerId, subSubSellers.id))
      .where(and(...conds))
      .orderBy(asc(payoutMutations.payoutDate))
      .limit(PayoutProfitService.MAX_ROWS + 1);

    const truncated = rows.length > PayoutProfitService.MAX_ROWS;
    const used = truncated ? rows.slice(0, PayoutProfitService.MAX_ROWS) : rows;

    const totals = blank();
    const bySubSeller = new Map<string, Group>();
    const byShop = new Map<string, Group>();
    const byMonth = new Map<string, Group>();
    const byMarketplace = new Map<string, Group>();
    const batchIds = new Set<string>();

    for (const r of used) {
      const m: Money = {
        credit: cents(r.credit),
        sedekah: cents(r.sedekah),
        sellerGross: cents(r.seller),
        material: cents(r.material),
        subSeller: cents(r.subSeller),
        subSubSeller: cents(r.subSubSeller),
      };
      if (r.batchId) batchIds.add(r.batchId);
      add(totals, m);

      // Payouts with no sub-seller are the seller's own shops. They are a real
      // row in this table rather than being dropped: "how much came from shops
      // nobody takes a commission on" is half the point of the breakdown.
      const subKey = r.subSellerId ?? "__sendiri__";
      add(bucket(bySubSeller, subKey, r.subSellerName ?? "Toko sendiri"), m);

      const shopKey = r.shopId ?? "__tanpa_toko__";
      const shopLabel = r.shopName ?? r.shopFallback ?? "(toko terhapus)";
      const shopGroup = bucket(byShop, shopKey, shopLabel);
      shopGroup.marketplace = r.marketplace ?? null;
      shopGroup.owner = r.subSubSellerName ?? r.subSellerName ?? null;
      add(shopGroup, m);

      add(bucket(byMonth, String(r.payoutDate).slice(0, 7), String(r.payoutDate).slice(0, 7)), m);
      add(bucket(byMarketplace, r.marketplace ?? "-", r.marketplace ?? "-"), m);
    }

    const dates = used.map((r) => String(r.payoutDate)).filter(Boolean);

    return {
      range: {
        from: opts.from ?? null,
        to: opts.to ?? null,
        firstPayout: dates.length ? dates[0] : null,
        lastPayout: dates.length ? dates[dates.length - 1] : null,
      },
      onlySettled: opts.onlySettled === true,
      counts: {
        mutations: used.length,
        batches: batchIds.size,
        shops: byShop.size,
        subSellers: [...bySubSeller.keys()].filter((k) => k !== "__sendiri__").length,
      },
      totals: shape(totals),
      bySubSeller: sorted(bySubSeller).map((g) => ({
        ...shape(g),
        id: g.key === "__sendiri__" ? null : g.key,
        name: g.name,
        /**
         * What share of the credit this sub-seller's shops handed over. Not
         * read from the settings: the rate can be changed at any time, while
         * this is what the frozen figures actually add up to.
         */
        effectiveRate: g.credit > 0 ? g.subSeller / g.credit : 0,
      })),
      byShop: sorted(byShop).map((g) => ({
        ...shape(g),
        id: g.key,
        name: g.name,
        marketplace: g.marketplace,
        owner: g.owner,
      })),
      byMonth: [...byMonth.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((g) => ({ ...shape(g), month: g.key })),
      byMarketplace: sorted(byMarketplace).map((g) => ({ ...shape(g), marketplace: g.name })),
      truncated,
      /** Said out loud in the payload so no caller can present this as profit. */
      basis:
        "Bagian yang diterima, dari data pencairan. Belum dikurangi HPP/modal barang — " +
        "data pencairan tidak menyimpan produk apa yang terjual.",
    };
  }
}

interface Money {
  credit: number;
  sedekah: number;
  sellerGross: number;
  material: number;
  subSeller: number;
  subSubSeller: number;
}

interface Group extends Money {
  key: string;
  name: string;
  mutations: number;
  marketplace?: string | null;
  owner?: string | null;
}

/** Rupiah with two decimals; summed as integers so the total cannot drift. */
function cents(v: string | null): number {
  return v == null ? 0 : Math.round(Number(v) * 100);
}

function blank(): Group {
  return {
    key: "",
    name: "",
    mutations: 0,
    credit: 0,
    sedekah: 0,
    sellerGross: 0,
    material: 0,
    subSeller: 0,
    subSubSeller: 0,
  };
}

function bucket(map: Map<string, Group>, key: string, name: string): Group {
  let g = map.get(key);
  if (!g) {
    g = blank();
    g.key = key;
    g.name = name;
    map.set(key, g);
  }
  return g;
}

function add(g: Group, m: Money): void {
  g.mutations += 1;
  g.credit += m.credit;
  g.sedekah += m.sedekah;
  g.sellerGross += m.sellerGross;
  g.material += m.material;
  g.subSeller += m.subSeller;
  g.subSubSeller += m.subSubSeller;
}

/**
 * Cents to rupiah at the edge, and sellerNet derived by subtraction.
 *
 * Derived, never computed a second way: the reserve is carved out of the
 * seller's gross, so net + reserve must equal gross exactly. A second
 * percentage calculation here would round independently and the two halves
 * would stop adding up to the whole.
 */
function shape(g: Group) {
  return {
    mutations: g.mutations,
    credit: g.credit / 100,
    sedekah: g.sedekah / 100,
    sellerGross: g.sellerGross / 100,
    material: g.material / 100,
    sellerNet: (g.sellerGross - g.material) / 100,
    subSeller: g.subSeller / 100,
    subSubSeller: g.subSubSeller / 100,
  };
}

function sorted(map: Map<string, Group>): Group[] {
  return [...map.values()].sort((a, b) => b.credit - a.credit);
}
