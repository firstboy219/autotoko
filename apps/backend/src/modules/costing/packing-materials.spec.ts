import { describe, expect, it } from "vitest";
import { calculateHpp } from "@autotoko/shared";

/**
 * Packing materials are shared by every product and consumed once per
 * shipment, so an error here is wrong on every product at once.
 */
describe("packing materials in HPP", () => {
  const base = {
    materials: [{ quantity: 2, unitCost: 1000 }],
    serviceCostPerPcs: 500,
    avgUnitsPerOrder: 1,
  };

  it("changes nothing when no packing materials are set", () => {
    const before = calculateHpp({ ...base, packingCostPerOrder: 3000 });
    const after = calculateHpp({ ...base, packingCostPerOrder: 3000, packingMaterials: [] });
    expect(after.hppCents).toBe(before.hppCents);
    expect(after.packingMaterialCostCents).toBe(0);
  });

  it("ADDS to the manual figure rather than replacing it", () => {
    // Kardus 1 x 2000 + lakban 0.1 x 5000 = 2500, on top of 3000 handling.
    const r = calculateHpp({
      ...base,
      packingCostPerOrder: 3000,
      packingMaterials: [
        { quantity: 1, unitCost: 2000 },
        { quantity: 0.1, unitCost: 5000 },
      ],
    });
    expect(r.packingMaterialCostCents).toBe(2500 * 100);
    expect(r.packingPerOrderCents).toBe(5500 * 100);
    expect(r.packingCostCents).toBe(5500 * 100);
  });

  it("spreads the packing cost across the units that ship together", () => {
    const r = calculateHpp({
      ...base,
      avgUnitsPerOrder: 2,
      packingCostPerOrder: 0,
      packingMaterials: [{ quantity: 1, unitCost: 3000 }],
    });
    // 3000 per shipment, two units in it -> 1500 each.
    expect(r.packingCostCents).toBe(1500 * 100);
    // The per-shipment figure itself is unaffected by the division.
    expect(r.packingPerOrderCents).toBe(3000 * 100);
  });

  it("rounds once at the end, not per line", () => {
    const r = calculateHpp({
      ...base,
      packingCostPerOrder: 0,
      packingMaterials: Array.from({ length: 3 }, () => ({ quantity: 0.333, unitCost: 1 })),
    });
    // 3 x 0.333 = 0.999 -> 99.9 cents -> 100, not 3 x round(33.3) = 99.
    expect(r.packingMaterialCostCents).toBe(100);
  });

  it("ignores a line with unusable numbers instead of poisoning the total", () => {
    const r = calculateHpp({
      ...base,
      packingCostPerOrder: 1000,
      packingMaterials: [
        { quantity: 1, unitCost: 2000 },
        { quantity: Number.NaN, unitCost: 5000 },
      ],
    });
    expect(r.packingPerOrderCents).toBe(3000 * 100);
  });

  it("feeds through to hpp", () => {
    const withOut = calculateHpp({ ...base, packingCostPerOrder: 0 });
    const withIn = calculateHpp({
      ...base,
      packingCostPerOrder: 0,
      packingMaterials: [{ quantity: 1, unitCost: 2000 }],
    });
    expect(withIn.hppCents - withOut.hppCents).toBe(2000 * 100);
  });
});
