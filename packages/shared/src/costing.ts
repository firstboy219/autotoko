/**
 * Harga Pokok Produksi (COGS) and publish-price modelling.
 *
 * Lives in @autotoko/shared for the same reason payout.ts does: the backend
 * stores the config and the web form previews it live, and the two must never
 * disagree about money.
 *
 * Amounts are integer cents (rupiah × 100); rates are fractions in [0,1].
 *
 * The payout leg deliberately delegates to calculatePayoutSplit() rather than
 * re-deriving sedekah/reseller here — this page is a PROJECTION of what the
 * Pencairan module will actually do, so it has to use the same function or it
 * would slowly drift out of agreement with reality.
 */

import { calculatePayoutSplit, type SedekahBasis } from "./payout";

/* ------------------------------------------------------------------ HPP */

export interface MaterialLine {
  /** Amount of this material consumed by ONE finished product. */
  quantity: number;
  /** Cost of one unit of the material, in rupiah (may be fractional). */
  unitCost: number;
}

export interface HppInput {
  materials: MaterialLine[];
  /** Biaya jasa produksi per pcs, in rupiah. */
  serviceCostPerPcs: number;
}

export interface HppResult {
  materialCostCents: number;
  serviceCostCents: number;
  hppCents: number;
}

/**
 * Material cost is summed in rupiah and rounded ONCE at the end — rounding
 * each line first would visibly drift on recipes with many small-quantity
 * items (e.g. 0.5 g of something costing Rp 3/g).
 */
export function calculateHpp(input: HppInput): HppResult {
  let material = 0;
  for (const m of input.materials) {
    const q = Number(m.quantity);
    const c = Number(m.unitCost);
    if (!Number.isFinite(q) || !Number.isFinite(c)) continue;
    material += q * c;
  }
  const materialCostCents = Math.round(material * 100);
  const serviceCostCents = Math.round((Number(input.serviceCostPerPcs) || 0) * 100);
  return {
    materialCostCents,
    serviceCostCents,
    hppCents: materialCostCents + serviceCostCents,
  };
}

/* -------------------------------------------------------- publish price */

export interface PublishPricingInput {
  publishPriceCents: number;
  hppCents: number;
  /** All three are taken by the marketplace as a % of the PUBLISH price. */
  marketplaceFeeRate: number;
  eventRate: number;
  affiliatorRate: number;
  /** Ads are borne by the seller, not withheld by the marketplace. */
  adsRate: number;
  adsFixedCents: number;
  /** Applied to the payout once the seller withdraws it. */
  sedekahRate: number;
  resellerRate: number;
  sedekahBasis?: SedekahBasis;
}

export interface PublishPricingResult {
  publishPriceCents: number;
  /** --- withheld by the marketplace, off the publish price --- */
  marketplaceFeeCents: number;
  eventCents: number;
  affiliatorCents: number;
  marketplaceWithheldCents: number;
  /** What the marketplace actually transfers to the seller's account. */
  payoutCents: number;
  /** --- taken when the seller withdraws that payout --- */
  sedekahCents: number;
  resellerCents: number;
  /** Seller's share after sedekah + reseller, before their own costs. */
  sellerShareCents: number;
  /** --- the seller's own costs --- */
  hppCents: number;
  adsCents: number;
  /** Bottom line. */
  netProfitCents: number;
  /** Net profit as a fraction of the publish price (0 when price is 0). */
  netMarginRate: number;
}

export function calculatePublishPricing(input: PublishPricingInput): PublishPricingResult {
  const P = Math.max(0, Math.round(input.publishPriceCents));

  const marketplaceFeeCents = Math.round(P * clamp01(input.marketplaceFeeRate));
  const eventCents = Math.round(P * clamp01(input.eventRate));
  const affiliatorCents = Math.round(P * clamp01(input.affiliatorRate));
  const marketplaceWithheldCents = marketplaceFeeCents + eventCents + affiliatorCents;

  // Can't transfer a negative amount — if the rates sum past 100% the payout
  // floors at zero and the loss shows up in netProfit instead.
  const payoutCents = Math.max(0, P - marketplaceWithheldCents);

  const resellerRate = clamp01(input.resellerRate);
  const split = calculatePayoutSplit({
    creditCents: payoutCents,
    sedekahRate: clamp01(input.sedekahRate),
    sedekahBasis: input.sedekahBasis ?? "total_credit",
    // A zero reseller cut is scenario A (seller-owned), not a 0% sub-seller —
    // keeps the split identical to what the payout module would produce.
    subSellerRate: resellerRate > 0 ? resellerRate : null,
  });

  const adsCents =
    Math.round(P * clamp01(input.adsRate)) + Math.max(0, Math.round(input.adsFixedCents));

  const hppCents = Math.max(0, Math.round(input.hppCents));
  const netProfitCents = split.sellerCents - hppCents - adsCents;

  return {
    publishPriceCents: P,
    marketplaceFeeCents,
    eventCents,
    affiliatorCents,
    marketplaceWithheldCents,
    payoutCents,
    sedekahCents: split.sedekahCents,
    resellerCents: split.subSellerCents + split.subSubSellerCents,
    sellerShareCents: split.sellerCents,
    hppCents,
    adsCents,
    netProfitCents,
    netMarginRate: P > 0 ? netProfitCents / P : 0,
  };
}

/* ------------------------------------------------- reverse: target price */

export type PublishPriceTarget =
  | { kind: "margin"; marginRate: number }
  | { kind: "profit"; profitCents: number };

export interface RequiredPriceInput {
  hppCents: number;
  marketplaceFeeRate: number;
  eventRate: number;
  affiliatorRate: number;
  adsRate: number;
  adsFixedCents: number;
  sedekahRate: number;
  resellerRate: number;
  target: PublishPriceTarget;
}

/**
 * Solves for the publish price that hits a target profit.
 *
 * Closed form, ignoring per-step rounding:
 *   payoutFraction K = (1 − mp − event − aff) · (1 − sedekah) · (1 − reseller)
 *   netProfit(P)     = P·(K − adsRate) − hpp − adsFixed
 *
 * so for a target margin m (fraction of P):  P = (hpp + adsFixed) / (K − adsRate − m)
 * and for a fixed target profit T:           P = (hpp + adsFixed + T) / (K − adsRate)
 *
 * Returns null when the denominator is ≤ 0 — i.e. the fee structure eats the
 * price faster than it grows, so no price achieves the target. Feed the result
 * back through calculatePublishPricing() for the exact, rounded figures.
 */
export function requiredPublishPriceCents(input: RequiredPriceInput): number | null {
  const K =
    (1 - clamp01(input.marketplaceFeeRate) - clamp01(input.eventRate) - clamp01(input.affiliatorRate)) *
    (1 - clamp01(input.sedekahRate)) *
    (1 - clamp01(input.resellerRate));

  const adsRate = clamp01(input.adsRate);
  const fixed = input.hppCents + Math.max(0, input.adsFixedCents);

  let denominator: number;
  let numerator: number;
  if (input.target.kind === "margin") {
    denominator = K - adsRate - input.target.marginRate;
    numerator = fixed;
  } else {
    denominator = K - adsRate;
    numerator = fixed + input.target.profitCents;
  }

  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const price = numerator / denominator;
  if (!Number.isFinite(price) || price < 0) return null;
  return Math.ceil(price);
}

function clamp01(r: number): number {
  if (!Number.isFinite(r)) return 0;
  return Math.min(1, Math.max(0, r));
}
