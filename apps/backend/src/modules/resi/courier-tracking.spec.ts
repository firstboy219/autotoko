import { describe, expect, it } from "vitest";
import { classifyTrackingStatus, courierCode, decideFromStatus } from "./courier-tracking.js";

const BLOCK_TRANSIT = { blockInTransit: true };
const ALLOW_TRANSIT = { blockInTransit: false };

describe("classifyTrackingStatus", () => {
  it("recognises the statuses this check exists for", () => {
    expect(classifyTrackingStatus("CANCELED")).toBe("cancelled");
    expect(classifyTrackingStatus("Pesanan dibatalkan")).toBe("cancelled");
    expect(classifyTrackingStatus("RETUR KE PENGIRIM")).toBe("cancelled");
    expect(classifyTrackingStatus("DELIVERED")).toBe("delivered");
    expect(classifyTrackingStatus("TERKIRIM: DROP POINT")).toBe("delivered");
    expect(classifyTrackingStatus("ON PROCESS")).toBe("in_transit");
    expect(classifyTrackingStatus("Dalam perjalanan ke JAKARTA")).toBe("in_transit");
  });

  it("treats a waybill the courier has never seen as not_found, not as a problem", () => {
    // This is the NORMAL state while the parcel is still on the packing bench.
    expect(classifyTrackingStatus("Not Found")).toBe("not_found");
    expect(classifyTrackingStatus("Resi tidak ditemukan")).toBe("not_found");
    expect(classifyTrackingStatus("")).toBe("unknown");
    expect(classifyTrackingStatus(null)).toBe("unknown");
  });

  it("puts a requested pickup before an actual one", () => {
    // "REQUEST PICKUP" contains "PICKUP"; it has not been collected yet.
    expect(classifyTrackingStatus("REQUEST PICKUP")).toBe("pending");
    expect(classifyTrackingStatus("PICKED UP BY COURIER")).toBe("in_transit");
  });

  it("does not guess at a status it has never seen", () => {
    expect(classifyTrackingStatus("XYZ-42 SOMETHING")).toBe("unknown");
  });
});

describe("decideFromStatus", () => {
  it("blocks a cancelled parcel and says why", () => {
    const d = decideFromStatus("CANCELED BY SELLER", BLOCK_TRANSIT);
    expect(d.verdict).toBe("block");
    expect(d.reason).toMatch(/dibatalkan/i);
    expect(d.status).toBe("CANCELED BY SELLER");
  });

  it("blocks one already delivered", () => {
    expect(decideFromStatus("DELIVERED", BLOCK_TRANSIT).verdict).toBe("block");
  });

  it("blocks in-transit only while that guard is on", () => {
    expect(decideFromStatus("ON PROCESS", BLOCK_TRANSIT).verdict).toBe("block");
    expect(decideFromStatus("ON PROCESS", ALLOW_TRANSIT).verdict).toBe("allow");
    // Cancelled stays blocked either way — that one is never ambiguous.
    expect(decideFromStatus("CANCELED", ALLOW_TRANSIT).verdict).toBe("block");
  });

  it("ALWAYS lets an unseen or pending waybill through", () => {
    // The single most important case: at packing time the courier usually has
    // no record yet. Blocking here would stop every legitimate first scan.
    for (const s of ["Not Found", "", null, undefined, "PENDING", "XYZ UNKNOWN"]) {
      expect(decideFromStatus(s, BLOCK_TRANSIT).verdict).toBe("allow");
    }
  });

  it("carries the raw status through even when allowing", () => {
    expect(decideFromStatus("SOMETHING NEW", BLOCK_TRANSIT).status).toBe("SOMETHING NEW");
  });
});

describe("courierCode", () => {
  it("maps what the barcode reader detected to the provider's codes", () => {
    expect(courierCode("J&T")).toBe("jnt");
    expect(courierCode("JNE")).toBe("jne");
    expect(courierCode("SPX")).toBe("spx");
    expect(courierCode("SiCepat")).toBe("sicepat");
  });

  it("returns null when the courier is unknown, so no bogus lookup is made", () => {
    expect(courierCode(null)).toBeNull();
    expect(courierCode("Kurir Antah Berantah")).toBeNull();
  });
});
