import { describe, it, expect } from "vitest";
import { calculatePayoutSplit, type SplitResult } from "./payout-split";

const rupiah = (n: number) => n * 100; // rupiah -> integer cents

/** The core guarantee: the four shares always sum back to the credit exactly. */
function expectConserved(res: SplitResult, creditCents: number) {
  expect(
    res.sedekahCents + res.sellerCents + res.subSellerCents + res.subSubSellerCents,
  ).toBe(creditCents);
}

describe("calculatePayoutSplit", () => {
  it("Bagian 4.3 worked example — Scenario C, basis total_credit", () => {
    const credit = rupiah(1_000_000);
    const res = calculatePayoutSplit({
      creditCents: credit,
      sedekahRate: 0.05,
      sedekahBasis: "total_credit",
      subSellerRate: 0.2,
      subSubSellerRate: 0.5,
    });
    expect(res.scenario).toBe("C");
    expect(res.sedekahCents).toBe(rupiah(50_000));
    expect(res.sellerCents).toBe(rupiah(760_000));
    expect(res.subSubSellerCents).toBe(rupiah(95_000));
    expect(res.subSellerCents).toBe(rupiah(95_000));
    expectConserved(res, credit);
  });

  it("Scenario A — shop owned by the Seller (no sub-seller)", () => {
    const credit = rupiah(1_000_000);
    const res = calculatePayoutSplit({
      creditCents: credit,
      sedekahRate: 0.05,
      sedekahBasis: "total_credit",
    });
    expect(res.scenario).toBe("A");
    expect(res.sedekahCents).toBe(rupiah(50_000));
    expect(res.sellerCents).toBe(rupiah(950_000));
    expect(res.subSellerCents).toBe(0);
    expect(res.subSubSellerCents).toBe(0);
    expectConserved(res, credit);
  });

  it("Scenario B, basis total_credit — sub-seller shares the post-sedekah remainder", () => {
    const credit = rupiah(1_000_000);
    const res = calculatePayoutSplit({
      creditCents: credit,
      sedekahRate: 0.05,
      sedekahBasis: "total_credit",
      subSellerRate: 0.2,
    });
    expect(res.scenario).toBe("B");
    expect(res.sedekahCents).toBe(rupiah(50_000)); // 5% of 1,000,000
    expect(res.subSellerCents).toBe(rupiah(190_000)); // 20% of 950,000
    expect(res.sellerCents).toBe(rupiah(760_000)); // remainder
    expect(res.subSubSellerCents).toBe(0);
    expectConserved(res, credit);
  });

  it("Scenario B, basis after_subseller_split — sub-seller is not charged sedekah", () => {
    const credit = rupiah(1_000_000);
    const res = calculatePayoutSplit({
      creditCents: credit,
      sedekahRate: 0.05,
      sedekahBasis: "after_subseller_split",
      subSellerRate: 0.2,
    });
    expect(res.scenario).toBe("B");
    expect(res.subSellerCents).toBe(rupiah(200_000)); // 20% of the full credit
    // sedekah = 5% of the remaining 800,000 = 40,000
    expect(res.sedekahCents).toBe(rupiah(40_000));
    expect(res.sellerCents).toBe(rupiah(760_000)); // 800,000 - 40,000
    expectConserved(res, credit);
  });

  it("Scenario C, basis after_subseller_split", () => {
    const credit = rupiah(1_000_000);
    const res = calculatePayoutSplit({
      creditCents: credit,
      sedekahRate: 0.05,
      sedekahBasis: "after_subseller_split",
      subSellerRate: 0.2,
      subSubSellerRate: 0.5,
    });
    expect(res.scenario).toBe("C");
    // sub-seller gross = 200,000; sub-sub takes 50% = 100,000; sub keeps 100,000
    expect(res.subSubSellerCents).toBe(rupiah(100_000));
    expect(res.subSellerCents).toBe(rupiah(100_000));
    expect(res.sedekahCents).toBe(rupiah(40_000)); // 5% of 800,000
    expect(res.sellerCents).toBe(rupiah(760_000));
    expectConserved(res, credit);
  });

  it("stays conserved on amounts that force rounding (no lost cents)", () => {
    // 333,333 rupiah with awkward rates — the classic place a cent goes missing.
    const credit = rupiah(333_333) + 33; // 33,333,333 cents
    const cases = [
      { basis: "total_credit" as const, sub: 0.333, subsub: 0.5 },
      { basis: "after_subseller_split" as const, sub: 0.17, subsub: 0.33 },
      { basis: "total_credit" as const, sub: 0.2, subsub: null },
      { basis: "total_credit" as const, sub: null, subsub: null },
    ];
    for (const c of cases) {
      const res = calculatePayoutSplit({
        creditCents: credit,
        sedekahRate: 0.075,
        sedekahBasis: c.basis,
        subSellerRate: c.sub,
        subSubSellerRate: c.subsub,
      });
      expectConserved(res, credit);
      // no negative shares
      for (const v of [
        res.sedekahCents,
        res.sellerCents,
        res.subSellerCents,
        res.subSubSellerCents,
      ]) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("brute-force conservation across many credits and rates", () => {
    for (let credit = 0; credit <= 2_000_00; credit += 777) {
      for (const sedekahRate of [0, 0.03, 0.05, 0.111]) {
        for (const subSellerRate of [null, 0, 0.2, 0.333, 1]) {
          for (const subSubSellerRate of subSellerRate == null ? [null] : [null, 0.5, 0.667, 1]) {
            for (const basis of ["total_credit", "after_subseller_split"] as const) {
              const res = calculatePayoutSplit({
                creditCents: credit,
                sedekahRate,
                sedekahBasis: basis,
                subSellerRate,
                subSubSellerRate,
              });
              expectConserved(res, credit);
            }
          }
        }
      }
    }
  });

  it("rejects an invalid hierarchy (sub-sub without sub)", () => {
    expect(() =>
      calculatePayoutSplit({
        creditCents: rupiah(1000),
        sedekahRate: 0.05,
        sedekahBasis: "total_credit",
        subSellerRate: null,
        subSubSellerRate: 0.5,
      }),
    ).toThrow();
  });

  it("rejects out-of-range rate and non-integer credit", () => {
    expect(() =>
      calculatePayoutSplit({ creditCents: 100, sedekahRate: 1.5, sedekahBasis: "total_credit" }),
    ).toThrow();
    expect(() =>
      calculatePayoutSplit({ creditCents: 100.5, sedekahRate: 0.05, sedekahBasis: "total_credit" }),
    ).toThrow();
  });
});
