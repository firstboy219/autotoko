import { DEFAULT_STATUS_MAP } from "./peta-tiktok.js";

/**
 * Konfigurasi status order yang FLEKSIBEL & data-driven (diatur di Admin CMS).
 * Formatnya Internal -> TikTok: tiap tahap internal AutoToko punya label yang
 * bisa diganti, padanan status marketplace, jenis (flow=alur berurutan /
 * side=samping), dan URUTAN (posisi di array). Admin bisa rename, urutkan, dan
 * tambah status baru.
 */
export interface StatusRow {
  key: string;
  label: string;
  marketplace: string; // status TikTok padanan; "" = murni internal
  kind: "flow" | "side";
}

export const DEFAULT_STATUS_CONFIG: StatusRow[] = [
  { key: "masuk", label: "Menunggu Disetujui", marketplace: "AWAITING_SHIPMENT", kind: "flow" },
  { key: "approved", label: "Menunggu Dicetak", marketplace: "AWAITING_COLLECTION", kind: "flow" },
  { key: "packing", label: "Menunggu Dipacking", marketplace: "AWAITING_COLLECTION", kind: "flow" },
  { key: "siap_kirim", label: "Menunggu Dipickup", marketplace: "AWAITING_COLLECTION", kind: "flow" },
  { key: "dikirim", label: "Dalam Pengiriman", marketplace: "IN_TRANSIT", kind: "flow" },
  { key: "selesai", label: "Selesai", marketplace: "COMPLETED", kind: "side" },
  { key: "retur", label: "Retur", marketplace: "", kind: "side" },
  { key: "dibatalkan", label: "Dibatalkan", marketplace: "CANCELLED", kind: "side" },
];

export const MP_STATUSES = [
  "UNPAID", "ON_HOLD", "AWAITING_SHIPMENT", "AWAITING_COLLECTION",
  "PARTIALLY_SHIPPING", "IN_TRANSIT", "DELIVERED", "COMPLETED", "CANCELLED",
];

export const MP_STATUS_LABEL: Record<string, string> = {
  UNPAID: "Belum Bayar", ON_HOLD: "Ditahan", AWAITING_SHIPMENT: "Menunggu Diproses",
  AWAITING_COLLECTION: "Menunggu Pickup", PARTIALLY_SHIPPING: "Sebagian Dikirim",
  IN_TRANSIT: "Dalam Pengiriman", DELIVERED: "Terkirim", COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan", CANCELED: "Dibatalkan",
};

const KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;

/** Baca & validasi config tersimpan; fallback ke default bila kosong/rusak. */
export function parseStatusConfig(raw: string | null | undefined): StatusRow[] {
  if (!raw) return DEFAULT_STATUS_CONFIG;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr.length) return DEFAULT_STATUS_CONFIG;
    const seen = new Set<string>();
    const rows: StatusRow[] = [];
    for (const r of arr) {
      const key = String(r?.key ?? "").trim();
      if (!KEY_RE.test(key) || seen.has(key)) continue;
      seen.add(key);
      rows.push({
        key,
        label: String(r?.label ?? key).slice(0, 64) || key,
        marketplace: MP_STATUSES.includes(String(r?.marketplace)) ? String(r.marketplace) : "",
        kind: r?.kind === "side" ? "side" : "flow",
      });
    }
    return rows.length ? rows : DEFAULT_STATUS_CONFIG;
  } catch {
    return DEFAULT_STATUS_CONFIG;
  }
}

export interface DerivedStatus {
  flow: string[];
  side: string[];
  label: Record<string, string>;
  /** internal -> marketplace (padanan yg dipilih admin; "" -> null). */
  marketplaceEquivalent: Record<string, string | null>;
  /** marketplace -> internal (FLOOR): default kode ditimpa pilihan config. */
  marketplaceMap: Record<string, string>;
}

export function deriveStatus(cfg: StatusRow[]): DerivedStatus {
  const flow: string[] = [];
  const side: string[] = [];
  const label: Record<string, string> = {};
  const marketplaceEquivalent: Record<string, string | null> = {};
  const fromCfg: Record<string, string> = {};
  for (const r of cfg) {
    label[r.key] = r.label;
    marketplaceEquivalent[r.key] = r.marketplace || null;
    (r.kind === "side" ? side : flow).push(r.key);
  }
  // marketplace -> internal FLOOR: baris flow PERTAMA (urutan) yang memetakan ke
  // status marketplace itu; lalu baris SIDE (terminal) selalu menang utk-nya.
  for (const r of cfg) if (r.kind === "flow" && r.marketplace && !(r.marketplace in fromCfg)) fromCfg[r.marketplace] = r.key;
  for (const r of cfg) if (r.kind === "side" && r.marketplace) fromCfg[r.marketplace] = r.key;
  const marketplaceMap: Record<string, string> = { ...DEFAULT_STATUS_MAP, ...fromCfg };
  return { flow, side, label, marketplaceEquivalent, marketplaceMap };
}
