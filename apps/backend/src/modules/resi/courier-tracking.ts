/**
 * Asking the courier whether a parcel should be going out at all.
 *
 * The decision logic here is pure and separately tested because it is the only
 * part that can be got right without an API key, and because a wrong decision
 * is expensive in BOTH directions: block a legitimate parcel and the packing
 * bench stops; wave through a cancelled one and the seller ships goods nobody
 * is paying for.
 */

export type TrackingCategory =
  | "unknown"
  | "not_found"
  | "pending"
  | "in_transit"
  | "delivered"
  | "cancelled";

export interface TrackingDecision {
  verdict: "allow" | "block";
  category: TrackingCategory;
  /** Exactly what the courier said, kept so a wrong mapping is visible. */
  status: string | null;
  /** Message for the packer, only when blocked. */
  reason: string | null;
}

/**
 * Substrings, matched against an upper-cased status. Order matters: the first
 * list that hits wins, so the unambiguous outcomes are checked before the
 * vaguer ones.
 *
 * These come from courier documentation and sample responses, not from
 * observing this seller's own traffic, so they will need tuning. That is why
 * the raw status is stored on every scan: a status this list does not know
 * lands in "unknown" and is allowed through, which is the safe direction, and
 * shows up in the data where it can be added.
 */
const CANCELLED = [
  "CANCEL", "DIBATALKAN", "BATAL", "VOID", "DELETED", "DIHAPUS",
  "RETUR", "RETURN", "RTS", "DIKEMBALIKAN",
];
const DELIVERED = [
  "DELIVERED", "TERKIRIM", "DITERIMA", "POD", "SELESAI", "COMPLETE",
];
const IN_TRANSIT = [
  "ON PROCESS", "ON_PROCESS", "ONPROCESS", "IN TRANSIT", "TRANSIT",
  "PERJALANAN", "PENGIRIMAN", "DIKIRIM", "MANIFEST", "PICKED UP", "PICKUP",
  "DROP OFF", "DROPOFF", "OUT FOR DELIVERY", "WITH COURIER", "ON DELIVERY",
];
const PENDING = [
  "PENDING", "WAITING", "MENUNGGU", "BELUM DIPROSES", "ORDER CREATED",
  "DATA DITERIMA", "SHIPMENT CREATED", "REQUEST PICKUP",
];
const NOT_FOUND = [
  "NOT FOUND", "TIDAK DITEMUKAN", "TIDAK VALID", "INVALID", "BELUM TERDAFTAR",
  "NO DATA", "UNKNOWN AWB",
];

function hits(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

export function classifyTrackingStatus(raw: string | null | undefined): TrackingCategory {
  if (!raw || !raw.trim()) return "unknown";
  const s = raw.toUpperCase();

  // Cancelled and returned first: they are the reason this check exists.
  if (hits(s, CANCELLED)) return "cancelled";
  if (hits(s, NOT_FOUND)) return "not_found";
  if (hits(s, DELIVERED)) return "delivered";
  // Pending before in-transit: "REQUEST PICKUP" contains "PICKUP", and a
  // requested pickup has not happened yet.
  if (hits(s, PENDING)) return "pending";
  if (hits(s, IN_TRANSIT)) return "in_transit";
  return "unknown";
}

export interface DecideOptions {
  /**
   * Whether an already-moving parcel should be refused.
   *
   * Default on, because scanning one means it was handed over twice. Made
   * switchable because some couriers register the waybill the moment the label
   * is printed: if a courier reports "ON PROCESS" from that instant, every
   * legitimate first scan would be refused and the bench would stop. Turning it
   * off keeps the cancelled/delivered guards, which are unambiguous.
   */
  blockInTransit: boolean;
}

export function decideFromStatus(
  raw: string | null | undefined,
  opts: DecideOptions,
): TrackingDecision {
  const category = classifyTrackingStatus(raw);
  const status = raw?.trim() || null;

  switch (category) {
    case "cancelled":
      return {
        verdict: "block",
        category,
        status,
        reason: "Pesanan ini sudah dibatalkan / diretur di kurir. Jangan dikirim.",
      };
    case "delivered":
      return {
        verdict: "block",
        category,
        status,
        reason: "Resi ini sudah berstatus terkirim di kurir. Kemungkinan tertukar.",
      };
    case "in_transit":
      return opts.blockInTransit
        ? {
            verdict: "block",
            category,
            status,
            reason: "Resi ini sudah dalam pengiriman di kurir. Kemungkinan sudah diserahkan.",
          }
        : { verdict: "allow", category, status, reason: null };
    // Not found is the NORMAL case at packing time: the label exists but the
    // courier has not scanned it yet. Refusing it would break every first scan.
    case "not_found":
    case "pending":
    case "unknown":
    default:
      return { verdict: "allow", category, status, reason: null };
  }
}

/** Our courier labels mapped to the tracking provider's codes. */
const COURIER_CODES: Record<string, string> = {
  "J&T": "jnt",
  JNE: "jne",
  SPX: "spx",
  SiCepat: "sicepat",
  Anteraja: "anteraja",
  Ninja: "ninja",
  "ID Express": "ide",
  "Lion Parcel": "lion",
  POS: "pos",
};

export function courierCode(detected: string | null | undefined): string | null {
  if (!detected) return null;
  return COURIER_CODES[detected] ?? null;
}
