import { describe, expect, it } from "vitest";
import { calculatePayoutSplit } from "@autotoko/shared";

/**
 * The material reserve carves up the seller's OWN share. Nothing else in the
 * split may move because of it — that is the property worth pinning down,
 * since a bug here would quietly change what a sub-seller is owed.
 */
describe("material reserve", () => {
  const base = {
    creditCents: 10_000_00,
    sedekahRate: 0.05,
    sedekahBasis: "total_credit" as const,
    subSellerRate: 0.2,
  };

  it("takes nothing when the rate is unset", () => {
    const r = calculatePayoutSplit(base);
    expect(r.sellerMaterialCents).toBe(0);
    expect(r.sellerNetCents).toBe(r.sellerCents);
  });

  it("splits the seller's share at 50% and nothing else changes", () => {
    const without = calculatePayoutSplit(base);
    const with50 = calculatePayoutSplit({ ...base, materialReserveRate: 0.5 });

    expect(with50.sedekahCents).toBe(without.sedekahCents);
    expect(with50.subSellerCents).toBe(without.subSellerCents);
    expect(with50.subSubSellerCents).toBe(without.subSubSellerCents);
    expect(with50.sellerCents).toBe(without.sellerCents);

    expect(with50.sellerMaterialCents).toBe(Math.round(without.sellerCents * 0.5));
    expect(with50.sellerMaterialCents + with50.sellerNetCents).toBe(with50.sellerCents);
  });

  it("keeps the original invariant exactly", () => {
    const r = calculatePayoutSplit({ ...base, materialReserveRate: 0.5 });
    expect(r.sedekahCents + r.sellerCents + r.subSellerCents + r.subSubSellerCents).toBe(
      base.creditCents,
    );
  });

  it("never loses a cent to rounding, at any rate", () => {
    for (const credit of [1, 3, 7, 99, 1_234_57, 9_999_999]) {
      for (const rate of [0, 0.01, 0.3333, 0.5, 0.6667, 1]) {
        const r = calculatePayoutSplit({ ...base, creditCents: credit, materialReserveRate: rate });
        expect(r.sellerMaterialCents + r.sellerNetCents).toBe(r.sellerCents);
        expect(r.sellerMaterialCents).toBeGreaterThanOrEqual(0);
        expect(r.sellerNetCents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("works in every scenario, including with a sub-sub-seller", () => {
    const c = calculatePayoutSplit({
      ...base,
      subSubSellerRate: 0.25,
      materialReserveRate: 0.5,
    });
    expect(c.scenario).toBe("C");
    expect(c.sellerMaterialCents + c.sellerNetCents).toBe(c.sellerCents);

    const a = calculatePayoutSplit({
      creditCents: 1_000_00,
      sedekahRate: 0.05,
      sedekahBasis: "total_credit",
      materialReserveRate: 0.5,
    });
    expect(a.scenario).toBe("A");
    expect(a.sellerMaterialCents + a.sellerNetCents).toBe(a.sellerCents);
  });

  it("rejects a rate outside 0..1 rather than producing a negative remainder", () => {
    expect(() => calculatePayoutSplit({ ...base, materialReserveRate: 1.5 })).toThrow(
      /materialReserveRate/,
    );
    expect(() => calculatePayoutSplit({ ...base, materialReserveRate: -0.1 })).toThrow(
      /materialReserveRate/,
    );
  });

  it("at 100% the seller keeps nothing loose and it all goes to materials", () => {
    const r = calculatePayoutSplit({ ...base, materialReserveRate: 1 });
    expect(r.sellerMaterialCents).toBe(r.sellerCents);
    expect(r.sellerNetCents).toBe(0);
  });
});
