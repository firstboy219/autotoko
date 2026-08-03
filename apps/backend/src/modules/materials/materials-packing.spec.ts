import { describe, it, expect } from "vitest";
import { calculateHpp } from "@autotoko/shared";
import { normalizeName, parsePurchaseLines } from "./materials.service.js";

describe("packing cost: per resi -> per product", () => {
  it("spreads a per-shipment cost across the units that ship together", () => {
    // Rp 3.000 packing, 2 units per shipment -> Rp 1.500 per product.
    const r = calculateHpp({
      materials: [{ quantity: 1, unitCost: 10_000 }],
      serviceCostPerPcs: 2_000,
      packingCostPerOrder: 3_000,
      avgUnitsPerOrder: 2,
    });
    expect(r.materialCostCents / 100).toBe(10_000);
    expect(r.serviceCostCents / 100).toBe(2_000);
    expect(r.packingCostCents / 100).toBe(1_500);
    expect(r.hppCents / 100).toBe(13_500);
  });

  it("charges the full packing cost when one unit ships per order", () => {
    const r = calculateHpp({
      materials: [],
      serviceCostPerPcs: 0,
      packingCostPerOrder: 3_000,
      avgUnitsPerOrder: 1,
    });
    expect(r.packingCostCents / 100).toBe(3_000);
  });

  it("treats a missing average as 1 rather than dividing by zero", () => {
    for (const units of [undefined, 0, Number.NaN, -5]) {
      const r = calculateHpp({
        materials: [],
        serviceCostPerPcs: 0,
        packingCostPerOrder: 3_000,
        avgUnitsPerOrder: units as number,
      });
      // Conservative: overstates HPP rather than silently understating it.
      expect(r.packingCostCents / 100).toBe(3_000);
      expect(Number.isFinite(r.hppCents)).toBe(true);
    }
  });

  it("handles a fractional average (e.g. 1.6 units per resi)", () => {
    const r = calculateHpp({
      materials: [],
      serviceCostPerPcs: 0,
      packingCostPerOrder: 5_000,
      avgUnitsPerOrder: 1.6,
    });
    expect(r.packingCostCents / 100).toBeCloseTo(3_125, 2);
  });

  it("omitting packing entirely leaves HPP exactly as before", () => {
    const r = calculateHpp({
      materials: [{ quantity: 2, unitCost: 1_500 }],
      serviceCostPerPcs: 2_500,
    });
    expect(r.packingCostCents).toBe(0);
    expect(r.hppCents / 100).toBe(5_500);
  });
});

describe("purchase receipt parsing", () => {
  it("reads 'name qty unit total' rows", () => {
    const lines = parsePurchaseLines(
      [
        "Biji Kopi Arabika   2 kg    Rp240.000",
        "Kemasan Kraft 200gr 100 pcs Rp150.000",
      ].join("\n"),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ name: "Biji Kopi Arabika", quantity: 2, unit: "kg", totalCost: 240_000 });
    expect(lines[1]!.quantity).toBe(100);
    expect(lines[1]!.totalCost).toBe(150_000);
  });

  it("reads the '2x Name  total' layout", () => {
    const lines = parsePurchaseLines("2x Tabung Inhaler    Rp13.000");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ name: "Tabung Inhaler", quantity: 2, totalCost: 13_000 });
  });

  it("skips summary rows so they never become phantom materials", () => {
    const lines = parsePurchaseLines(
      [
        "Oil Peppermint  5 ml  Rp10.000",
        "Subtotal              Rp10.000",
        "Ongkir                Rp 9.000",
        "Total                 Rp19.000",
      ].join("\n"),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.name).toBe("Oil Peppermint");
  });

  it("ignores lines with no quantity or no amount", () => {
    const lines = parsePurchaseLines(
      ["Toko Bahan Jaya", "Jl. Merdeka No. 12", "Terima kasih", "2 pcs"].join("\n"),
    );
    expect(lines).toHaveLength(0);
  });

  it("takes the line total when both unit price and total are printed", () => {
    const lines = parsePurchaseLines("Shrink Wrap  3 pcs  Rp1.500  Rp4.500");
    expect(lines[0]!.totalCost).toBe(4_500);
  });
});

describe("material name matching", () => {
  it("collapses case and spacing so OCR wobble doesn't fork the catalog", () => {
    expect(normalizeName("  Biji   Kopi Arabika ")).toBe("biji kopi arabika");
    expect(normalizeName("BIJI KOPI ARABIKA")).toBe(normalizeName("biji kopi arabika"));
  });

  it("keeps genuinely different names apart", () => {
    expect(normalizeName("Oil Peppermint")).not.toBe(normalizeName("Oil PPM"));
  });
});
