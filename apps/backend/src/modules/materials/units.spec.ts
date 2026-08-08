import { describe, it, expect } from "vitest";
import { convertUnit, compatibleUnits, unitsCompatible, unitKind } from "@autotoko/shared";

describe("konversi satuan bahan baku", () => {
  it("turns the delivery the seller described into what the catalogue counts", () => {
    // The case this was built for: glycerine arrives as a 1 kg jug and a 5 kg
    // jug, and the catalogue holds glycerine in grams.
    expect(convertUnit(1, "kg", "gram")).toBe(1000);
    expect(convertUnit(5, "kg", "gram")).toBe(5000);
    // Six kilos on the shelf, in the unit a recipe consumes.
    expect(convertUnit(1, "kg", "gram")! + convertUnit(5, "kg", "gram")!).toBe(6000);
  });

  it("converts volume both ways", () => {
    expect(convertUnit(1, "liter", "ml")).toBe(1000);
    expect(convertUnit(250, "ml", "liter")).toBe(0.25);
  });

  it("refuses to guess across kinds", () => {
    // A millilitre of jojoba oil is not a gram of it. There is one bom_items
    // row in production asking for glycerine in ml against a catalogue in
    // gram; the honest answer is to refuse, not to assume water.
    expect(convertUnit(50, "ml", "gram")).toBeNull();
    expect(convertUnit(1, "kg", "pcs")).toBeNull();
    expect(unitsCompatible("ml", "gram")).toBe(false);
  });

  it("does not care how the unit was spelled", () => {
    expect(convertUnit(2, "KG", "Gram")).toBe(2000);
    expect(convertUnit(2, " Kilogram ", "gr")).toBe(2000);
    expect(convertUnit(1, "Lt", "ML")).toBe(1000);
  });

  it("leaves a number alone when there is nothing to convert to", () => {
    // Materials in production exist with a null unit. Inventing a conversion
    // there would be worse than passing the number through.
    expect(convertUnit(7, "kg", null)).toBe(7);
    expect(convertUnit(7, null, "gram")).toBe(7);
    expect(convertUnit(7, "pcs", "pcs")).toBe(7);
  });

  it("returns null for a unit nobody recognises", () => {
    expect(convertUnit(1, "sachet", "gram")).toBeNull();
    expect(unitKind("sachet")).toBe("unknown");
  });

  it("offers the catalogue's own unit first", () => {
    const opts = compatibleUnits("gram");
    expect(opts[0]).toBe("gram");
    expect(opts).toContain("kg");
    expect(opts).not.toContain("ml");
  });

  it("does not offer to turn bottles into rolls", () => {
    // Both are counts, but they are not each other.
    const opts = compatibleUnits("botol");
    expect(opts).toEqual(["botol"]);
  });

  it("keeps an unrecognised unit usable as itself", () => {
    expect(compatibleUnits("sachet")).toEqual(["sachet"]);
    expect(convertUnit(3, "sachet", "sachet")).toBe(3);
  });

  it("counts a dozen as twelve", () => {
    expect(convertUnit(2, "lusin", "pcs")).toBe(24);
  });
});
