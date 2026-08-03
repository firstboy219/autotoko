import { describe, it, expect } from "vitest";
import { calculatePayoutSplit, type SedekahBasis } from "@autotoko/shared";

const rp = (c: number) => c / 100;
const CREDIT = 1_000_000_00; // Rp 1.000.000 in cents

/**
 * The three bases are the only coherent answers to "where is each cut taken
 * from" — a fourth ("sedekah from the remainder AND sub-seller from the
 * remainder") is circular and has no solution, which is why sedekah and
 * sub-seller share one setting rather than having one each.
 */
describe("sedekah basis — where each cut comes from", () => {
  it("total_credit: sedekah off the full credit, sub-seller off what's left", () => {
    const r = calculatePayoutSplit({
      creditCents: CREDIT,
      sedekahRate: 0.05,
      sedekahBasis: "total_credit",
      subSellerRate: 0.2,
    });
    expect(rp(r.sedekahCents)).toBe(50_000); // 5% of 1.000.000
    expect(rp(r.subSellerCents)).toBe(190_000); // 20% of the remaining 950.000
    expect(rp(r.sellerCents)).toBe(760_000);
  });

  it("after_subseller_split: sub-seller off the full credit, sedekah off the rest", () => {
    const r = calculatePayoutSplit({
      creditCents: CREDIT,
      sedekahRate: 0.05,
      sedekahBasis: "after_subseller_split",
      subSellerRate: 0.2,
    });
    expect(rp(r.subSellerCents)).toBe(200_000); // 20% of 1.000.000
    expect(rp(r.sedekahCents)).toBe(40_000); // 5% of the remaining 800.000
    expect(rp(r.sellerCents)).toBe(760_000);
  });

  it("both_from_total: each computed on the full credit, independently", () => {
    const r = calculatePayoutSplit({
      creditCents: CREDIT,
      sedekahRate: 0.05,
      sedekahBasis: "both_from_total",
      subSellerRate: 0.2,
    });
    expect(rp(r.sedekahCents)).toBe(50_000); // 5% of 1.000.000
    expect(rp(r.subSellerCents)).toBe(200_000); // 20% of 1.000.000
    expect(rp(r.sellerCents)).toBe(750_000);
  });

  it("the three bases genuinely differ — otherwise the setting would be pointless", () => {
    const of = (b: SedekahBasis) =>
      calculatePayoutSplit({
        creditCents: CREDIT,
        sedekahRate: 0.05,
        sedekahBasis: b,
        subSellerRate: 0.2,
      });
    const a = of("total_credit");
    const b = of("after_subseller_split");
    const c = of("both_from_total");
    expect(a.sedekahCents).not.toBe(b.sedekahCents);
    expect(a.subSellerCents).not.toBe(c.subSellerCents);
    expect(b.sedekahCents).not.toBe(c.sedekahCents);
  });
});

describe("conservation holds for every basis", () => {
  const BASES: SedekahBasis[] = ["total_credit", "after_subseller_split", "both_from_total"];

  it("nothing is invented or lost, across rates and odd amounts", () => {
    for (const basis of BASES) {
      for (const credit of [1, 7, 333, 99_999, 1_234_567_89]) {
        for (const sed of [0, 0.025, 0.05, 0.1]) {
          for (const sub of [0, 0.15, 0.2, 0.333]) {
            const r = calculatePayoutSplit({
              creditCents: credit,
              sedekahRate: sed,
              sedekahBasis: basis,
              subSellerRate: sub,
            });
            const total =
              r.sedekahCents + r.sellerCents + r.subSellerCents + r.subSubSellerCents;
            expect(total).toBe(credit);
            expect(r.sellerCents).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it("holds with a sub-sub-seller in the chain too", () => {
    for (const basis of BASES) {
      const r = calculatePayoutSplit({
        creditCents: 987_654_32,
        sedekahRate: 0.05,
        sedekahBasis: basis,
        subSellerRate: 0.2,
        subSubSellerRate: 0.5,
      });
      expect(
        r.sedekahCents + r.sellerCents + r.subSellerCents + r.subSubSellerCents,
      ).toBe(987_654_32);
      expect(r.scenario).toBe("C");
    }
  });
});

describe("both_from_total guards against over-allocation", () => {
  it("rejects rates that together exceed the credit", () => {
    expect(() =>
      calculatePayoutSplit({
        creditCents: CREDIT,
        sedekahRate: 0.5,
        sedekahBasis: "both_from_total",
        subSellerRate: 0.6,
      }),
    ).toThrow(/exceeds 100%/);
  });

  it("accepts rates that sum to exactly 100% (seller simply gets nothing)", () => {
    const r = calculatePayoutSplit({
      creditCents: CREDIT,
      sedekahRate: 0.3,
      sedekahBasis: "both_from_total",
      subSellerRate: 0.7,
    });
    expect(rp(r.sellerCents)).toBe(0);
    expect(r.sedekahCents + r.subSellerCents).toBe(CREDIT);
  });

  it("the other two bases can never over-allocate, even at extreme rates", () => {
    for (const basis of ["total_credit", "after_subseller_split"] as SedekahBasis[]) {
      const r = calculatePayoutSplit({
        creditCents: CREDIT,
        sedekahRate: 1,
        sedekahBasis: basis,
        subSellerRate: 1,
      });
      expect(r.sellerCents).toBeGreaterThanOrEqual(0);
      expect(
        r.sedekahCents + r.sellerCents + r.subSellerCents + r.subSubSellerCents,
      ).toBe(CREDIT);
    }
  });
});

describe("scenario A ignores the basis entirely", () => {
  it("with no sub-seller there is no ordering question to answer", () => {
    const results = (["total_credit", "after_subseller_split", "both_from_total"] as SedekahBasis[])
      .map((b) =>
        calculatePayoutSplit({ creditCents: CREDIT, sedekahRate: 0.05, sedekahBasis: b }),
      );
    for (const r of results) {
      expect(r.scenario).toBe("A");
      expect(rp(r.sedekahCents)).toBe(50_000);
      expect(rp(r.sellerCents)).toBe(950_000);
    }
  });
});
