import { describe, expect, it } from "vitest";
import { detectCourier, normalizeResi } from "./resi.service.js";

describe("normalizeResi — the duplicate guard's comparison key", () => {
  it("collapses the spacing and case OCR keeps changing its mind about", () => {
    const forms = ["JX 1234-5678 90", "jx1234567890", "JX1234567890", " JX-1234 5678-90 "];
    const keys = new Set(forms.map(normalizeResi));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("JX1234567890");
  });

  it("does NOT fold O/0 or I/1 — those can be genuinely different parcels", () => {
    // Folding them would silently reject a real package with no override.
    expect(normalizeResi("IDX0S1")).not.toBe(normalizeResi("1DXO51"));
  });

  it("survives junk OCR picks up around the label", () => {
    expect(normalizeResi("Resi: JP0011223344 ")).toBe("RESIJP0011223344");
  });

  it("handles empty and null-ish input without throwing", () => {
    expect(normalizeResi("")).toBe("");
    expect(normalizeResi(undefined as unknown as string)).toBe("");
  });
});

describe("detectCourier", () => {
  it("labels the common Indonesian couriers", () => {
    expect(detectCourier("JX1234567890")).toBe("J&T");
    expect(detectCourier("SPXID123456789")).toBe("SPX");
    expect(detectCourier("NLID12345678")).toBe("Ninja");
    expect(detectCourier("LP123456789")).toBe("Lion Parcel");
  });

  it("returns null rather than guessing when nothing matches", () => {
    expect(detectCourier("ZZ999999")).toBeNull();
  });
});
