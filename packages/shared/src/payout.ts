/**
 * Payout split calculation (PAYOUT_MODULE_REQUIREMENT.md Bagian 4).
 *
 * Lives in @autotoko/shared so the backend (authoritative store) and the web
 * form (real-time preview) run the EXACT same money logic — no drift between
 * what the seller sees and what gets saved.
 *
 * Amounts are integer cents (rupiah × 100); rates are fractions in [0,1].
 * Invariant, every scenario/basis:
 *   sedekah + seller + subSeller + subSubSeller === credit   (exactly)
 * because every remainder party is derived by subtraction, never a second
 * rounded formula.
 */

export type SedekahBasis = "total_credit" | "after_subseller_split";

export interface SplitInput {
  creditCents: number;
  sedekahRate: number;
  sedekahBasis: SedekahBasis;
  subSellerRate?: number | null;
  subSubSellerRate?: number | null;
}

export interface SplitResult {
  sedekahCents: number;
  sellerCents: number;
  subSellerCents: number;
  subSubSellerCents: number;
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
    throw new Error("subSubSellerRate given without subSellerRate (invalid hierarchy)");
  }
}

export function calculatePayoutSplit(input: SplitInput): SplitResult {
  assertValid(input);
  const { creditCents, sedekahRate, sedekahBasis } = input;
  const subSellerRate = input.subSellerRate ?? null;
  const subSubSellerRate = input.subSubSellerRate ?? null;

  // Scenario A — shop belongs to the Seller directly.
  if (subSellerRate == null) {
    const sedekahCents = Math.round(creditCents * sedekahRate);
    return {
      sedekahCents,
      sellerCents: creditCents - sedekahCents,
      subSellerCents: 0,
      subSubSellerCents: 0,
      scenario: "A",
    };
  }

  let sedekahCents: number;
  let sellerCents: number;
  let subSellerGross: number;

  if (sedekahBasis === "total_credit") {
    sedekahCents = Math.round(creditCents * sedekahRate);
    const afterSedekah = creditCents - sedekahCents;
    subSellerGross = Math.round(afterSedekah * subSellerRate);
    sellerCents = afterSedekah - subSellerGross;
  } else {
    subSellerGross = Math.round(creditCents * subSellerRate);
    const sellerBeforeSedekah = creditCents - subSellerGross;
    sedekahCents = Math.round(sellerBeforeSedekah * sedekahRate);
    sellerCents = sellerBeforeSedekah - sedekahCents;
  }

  // Scenario B — shop belongs to the sub-seller directly.
  if (subSubSellerRate == null) {
    return {
      sedekahCents,
      sellerCents,
      subSellerCents: subSellerGross,
      subSubSellerCents: 0,
      scenario: "B",
    };
  }

  // Scenario C — sub-sub-seller takes a cut of the sub-seller's gross portion.
  const subSubSellerCents = Math.round(subSellerGross * subSubSellerRate);
  return {
    sedekahCents,
    sellerCents,
    subSellerCents: subSellerGross - subSubSellerCents,
    subSubSellerCents,
    scenario: "C",
  };
}
