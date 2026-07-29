import { describe, it, expect } from "vitest";
import {
  calculateHpp,
  calculatePublishPricing,
  requiredPublishPriceCents,
} from "@autotoko/shared";

const rp = (cents: number) => cents / 100;

describe("harga pokok produksi", () => {
  it("sums material lines and adds the per-pcs service cost", () => {
    const r = calculateHpp({
      materials: [
        { quantity: 2, unitCost: 1500 }, // 3.000
        { quantity: 0.5, unitCost: 8000 }, // 4.000
      ],
      serviceCostPerPcs: 2500,
    });
    expect(rp(r.materialCostCents)).toBe(7000);
    expect(rp(r.serviceCostCents)).toBe(2500);
    expect(rp(r.hppCents)).toBe(9500);
  });

  it("rounds once at the end, so many tiny fractional lines don't drift", () => {
    // 3 lines of 0.5 g @ Rp 3/g = Rp 1.5 each. Rounding per line would give
    // Rp 6 (2+2+2); rounding once gives the correct Rp 4.5 -> 450 cents.
    const r = calculateHpp({
      materials: Array.from({ length: 3 }, () => ({ quantity: 0.5, unitCost: 3 })),
      serviceCostPerPcs: 0,
    });
    expect(r.materialCostCents).toBe(450);
  });

  it("ignores non-numeric lines rather than producing NaN", () => {
    const r = calculateHpp({
      materials: [
        { quantity: 2, unitCost: 1000 },
        { quantity: Number.NaN, unitCost: 500 },
      ],
      serviceCostPerPcs: 0,
    });
    expect(rp(r.hppCents)).toBe(2000);
  });
});

describe("harga publish -> profit bersih", () => {
  // The exact chain described by the seller: publish price is reduced by the
  // marketplace fee, event and affiliator (all % of publish); the remainder is
  // what the marketplace transfers; withdrawing that applies sedekah then the
  // reseller cut; finally HPP comes off.
  const base = {
    publishPriceCents: 100_000_00,
    hppCents: 30_000_00,
    marketplaceFeeRate: 0.15,
    eventRate: 0.05,
    affiliatorRate: 0.05,
    adsRate: 0,
    adsFixedCents: 0,
    sedekahRate: 0.05,
    resellerRate: 0.2,
  };

  it("walks the full chain with the seller's stated percentages", () => {
    const r = calculatePublishPricing(base);

    expect(rp(r.marketplaceFeeCents)).toBe(15_000);
    expect(rp(r.eventCents)).toBe(5_000);
    expect(rp(r.affiliatorCents)).toBe(5_000);
    expect(rp(r.marketplaceWithheldCents)).toBe(25_000);

    // What the marketplace actually transfers to the seller's account.
    expect(rp(r.payoutCents)).toBe(75_000);

    // Withdrawal: sedekah 5% of the payout, then reseller 20% of the remainder
    // — matching calculatePayoutSplit, which this delegates to.
    expect(rp(r.sedekahCents)).toBe(3_750);
    expect(rp(r.resellerCents)).toBe(14_250);
    expect(rp(r.sellerShareCents)).toBe(57_000);

    expect(rp(r.netProfitCents)).toBe(27_000);
    expect(r.netMarginRate).toBeCloseTo(0.27, 6);
  });

  it("conserves money at both stages (nothing invented or lost)", () => {
    const r = calculatePublishPricing({ ...base, affiliatorRate: 0.25 });
    expect(r.marketplaceWithheldCents + r.payoutCents).toBe(r.publishPriceCents);
    expect(r.sedekahCents + r.resellerCents + r.sellerShareCents).toBe(r.payoutCents);
  });

  it("treats ads as a seller cost, not a marketplace deduction", () => {
    const withAds = calculatePublishPricing({ ...base, adsRate: 0.1, adsFixedCents: 500_00 });
    const without = calculatePublishPricing(base);
    // Payout is untouched — the marketplace doesn't withhold ad spend.
    expect(withAds.payoutCents).toBe(without.payoutCents);
    // 10% of 100.000 + 500 fixed = 10.500 off the bottom line.
    expect(rp(withAds.adsCents)).toBe(10_500);
    expect(rp(withAds.netProfitCents)).toBe(27_000 - 10_500);
  });

  it("reports a loss rather than clamping when HPP exceeds what the seller keeps", () => {
    const r = calculatePublishPricing({ ...base, hppCents: 80_000_00 });
    expect(rp(r.netProfitCents)).toBe(57_000 - 80_000);
    expect(r.netProfitCents).toBeLessThan(0);
  });

  it("floors the payout at zero if the marketplace rates exceed 100%", () => {
    const r = calculatePublishPricing({
      ...base,
      marketplaceFeeRate: 0.6,
      eventRate: 0.3,
      affiliatorRate: 0.25,
    });
    expect(r.payoutCents).toBe(0);
    expect(r.netProfitCents).toBeLessThan(0);
  });

  it("a zero reseller cut leaves the whole payout with the seller after sedekah", () => {
    const r = calculatePublishPricing({ ...base, resellerRate: 0 });
    expect(rp(r.resellerCents)).toBe(0);
    expect(rp(r.sellerShareCents)).toBe(75_000 - 3_750);
  });
});

describe("menghitung harga publish dari target", () => {
  const cfg = {
    hppCents: 30_000_00,
    marketplaceFeeRate: 0.15,
    eventRate: 0.05,
    affiliatorRate: 0.05,
    adsRate: 0,
    adsFixedCents: 0,
    sedekahRate: 0.05,
    resellerRate: 0.2,
  };

  it("suggests a price that actually achieves the target margin when re-run forward", () => {
    const cents = requiredPublishPriceCents({ ...cfg, target: { kind: "margin", marginRate: 0.27 } });
    expect(cents).not.toBeNull();
    const forward = calculatePublishPricing({ ...cfg, publishPriceCents: cents! });
    // Round-tripping must land on the target, not merely near it.
    expect(forward.netMarginRate).toBeCloseTo(0.27, 4);
  });

  it("suggests a price that achieves a fixed rupiah profit target", () => {
    const cents = requiredPublishPriceCents({
      ...cfg,
      target: { kind: "profit", profitCents: 50_000_00 },
    });
    expect(cents).not.toBeNull();
    const forward = calculatePublishPricing({ ...cfg, publishPriceCents: cents! });
    expect(rp(forward.netProfitCents)).toBeCloseTo(50_000, 0);
  });

  it("accounts for ads when solving, so the target still holds", () => {
    const withAds = { ...cfg, adsRate: 0.1, adsFixedCents: 500_00 };
    const cents = requiredPublishPriceCents({
      ...withAds,
      target: { kind: "margin", marginRate: 0.2 },
    });
    expect(cents).not.toBeNull();
    const forward = calculatePublishPricing({ ...withAds, publishPriceCents: cents! });
    expect(forward.netMarginRate).toBeCloseTo(0.2, 4);
  });

  it("returns null when the fee structure makes the target unreachable at any price", () => {
    // Costs already consume ~57% of publish; a 60% margin cannot be reached by
    // raising the price, because the deductions scale with it.
    expect(
      requiredPublishPriceCents({ ...cfg, target: { kind: "margin", marginRate: 0.6 } }),
    ).toBeNull();
  });
});
