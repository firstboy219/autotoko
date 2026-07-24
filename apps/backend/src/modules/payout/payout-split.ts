/**
 * Payout split calculation (PAYOUT_MODULE_REQUIREMENT.md Bagian 4).
 *
 * All amounts are handled as INTEGER CENTS (rupiah × 100) so the arithmetic is
 * exact — the same convention wallet.service.ts uses. Rates are fractions in
 * [0, 1] (0.20 = 20%).
 *
 * The invariant this module guarantees, for every scenario and basis:
 *
 *     sedekah + seller + subSeller + subSubSeller === credit   (exactly)
 *
 * It holds because every "remainder" party (the seller at the top level, and
 * the sub-seller within its own portion) is derived by SUBTRACTION, never by an
 * independent rounded formula. Only the non-remainder pieces are rounded, so
 * rounding error can never leak out of the total.
 */

export type SedekahBasis = "total_credit" | "after_subseller_split";

export interface SplitInput {
  /** Settlement credit being split, in integer cents. */
  creditCents: number;
  /** Sedekah rate, fraction 0..1 (snapshot of the tenant setting). */
  sedekahRate: number;
  /** Which figure sedekah is taken from (Bagian 4.2). */
  sedekahBasis: SedekahBasis;
  /**
   * Sub-seller rate, fraction 0..1. Null/undefined means the shop belongs to
   * the Seller directly (Scenario A).
   */
  subSellerRate?: number | null;
  /**
   * Sub-sub-seller rate, fraction 0..1. Present only when the shop belongs to a
   * sub-sub-seller (Scenario C). Requires subSellerRate to also be present.
   */
  subSubSellerRate?: number | null;
}

export interface SplitResult {
  sedekahCents: number;
  sellerCents: number;
  subSellerCents: number;
  subSubSellerCents: number;
  /** "A" | "B" | "C" — which ownership scenario was applied. */
  scenario: "A" | "B" | "C";
}

function assertValid(input: SplitInput): void {
  const { creditCents, sedekahRate, subSellerRate, subSubSellerRate } = input;
  if (!Number.isInteger(creditCents) || creditCents < 0) {
    throw new Error(`creditCents must be a non-negative integer, got ${creditCents}`);
  }
  const inRange = (r: number | null | undefined) =>
    r == null || (Number.isFinite(r) && r >= 0 && r <= 1);
  if (!inRange(sedekahRate)) throw new Error(`sedekahRate out of range: ${sedekahRate}`);
  if (!inRange(subSellerRate)) throw new Error(`subSellerRate out of range: ${subSellerRate}`);
  if (!inRange(subSubSellerRate)) {
    throw new Error(`subSubSellerRate out of range: ${subSubSellerRate}`);
  }
  if (subSubSellerRate != null && subSellerRate == null) {
    // Mirrors the hierarchy rule: a sub-sub-seller cannot attach without a sub-seller.
    throw new Error("subSubSellerRate given without subSellerRate (invalid hierarchy)");
  }
}

/**
 * Split a settlement credit across sedekah / seller / sub-seller / sub-sub-seller.
 * Pure and side-effect free so it is trivially unit-testable and reusable from
 * the mutation-create service (never inline in a controller).
 */
export function calculatePayoutSplit(input: SplitInput): SplitResult {
  assertValid(input);
  const { creditCents, sedekahRate, sedekahBasis } = input;
  const subSellerRate = input.subSellerRate ?? null;
  const subSubSellerRate = input.subSubSellerRate ?? null;

  // Scenario A — shop belongs to the Seller directly. No sub-seller split.
  if (subSellerRate == null) {
    const sedekahCents = Math.round(creditCents * sedekahRate);
    const sellerCents = creditCents - sedekahCents; // remainder
    return {
      sedekahCents,
      sellerCents,
      subSellerCents: 0,
      subSubSellerCents: 0,
      scenario: "A",
    };
  }

  // Scenarios B & C both first compute the GROSS sub-seller portion and the
  // sedekah + seller pieces, differing only by basis. `subSellerGross` is the
  // sub-seller's cut before any sub-sub-seller is carved out of it.
  let sedekahCents: number;
  let sellerCents: number;
  let subSellerGross: number;

  if (sedekahBasis === "total_credit") {
    // Sedekah taken off the top; sub-seller shares the remainder.
    sedekahCents = Math.round(creditCents * sedekahRate);
    const afterSedekah = creditCents - sedekahCents;
    subSellerGross = Math.round(afterSedekah * subSellerRate);
    sellerCents = afterSedekah - subSellerGross; // remainder
  } else {
    // after_subseller_split: sub-seller is paid first and is NOT charged
    // sedekah; sedekah comes out of the seller's portion only.
    subSellerGross = Math.round(creditCents * subSellerRate);
    const sellerBeforeSedekah = creditCents - subSellerGross;
    sedekahCents = Math.round(sellerBeforeSedekah * sedekahRate);
    sellerCents = sellerBeforeSedekah - sedekahCents; // remainder
  }

  // Scenario B — shop belongs to the sub-seller directly. Nothing carved out.
  if (subSubSellerRate == null) {
    return {
      sedekahCents,
      sellerCents,
      subSellerCents: subSellerGross,
      subSubSellerCents: 0,
      scenario: "B",
    };
  }

  // Scenario C — sub-sub-seller takes a cut OF the sub-seller's gross portion;
  // the sub-seller keeps the remainder of its own portion.
  const subSubSellerCents = Math.round(subSellerGross * subSubSellerRate);
  const subSellerCents = subSellerGross - subSubSellerCents; // remainder
  return {
    sedekahCents,
    sellerCents,
    subSellerCents,
    subSubSellerCents,
    scenario: "C",
  };
}
