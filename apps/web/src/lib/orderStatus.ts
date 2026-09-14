/**
 * Sumber TUNGGAL status fulfillment untuk sisi WEB.
 *
 * Sebelumnya FLOW & label status disalin-tangan di beberapa halaman (Orders,
 * Kesehatan Pesanan) dan juga di APK — begitu aturan berubah, satu tempat bisa
 * ketinggalan (nyaris terjadi saat memperbaiki alur fulfillment). Semua halaman
 * web sekarang mengimpor dari sini; APK menurunkan bentuk yang sama dari
 * endpoint backend GET /orders/status-meta.
 */

/** Alur internal (berurutan) + status samping. */
export const FLOW = ["masuk", "approved", "packing", "siap_kirim", "dikirim"] as const;
export const SIDE = ["selesai", "retur", "dibatalkan"] as const;
export const ALL_FS = [...FLOW, ...SIDE];

export const FS_LABEL: Record<string, string> = {
  masuk: "Menunggu Disetujui", approved: "Menunggu Dicetak", produksi: "Produksi",
  packing: "Menunggu Dipacking", siap_kirim: "Menunggu Dipickup", dikirim: "Dalam Pengiriman",
  selesai: "Selesai", retur: "Retur", dibatalkan: "Dibatalkan",
};

/**
 * Padanan 1-on-1 dengan status marketplace. null = tahap ini murni RINCIAN
 * INTERNAL AutoToko; di marketplace order-nya masih berstatus "siap kirim".
 */
export const FS_MP_EQUIVALENT: Record<string, string | null> = {
  masuk: "Menunggu Disetujui / Perlu Diproses",
  approved: null, packing: null, siap_kirim: null,
  dikirim: "Dalam Pengiriman", selesai: "Selesai", retur: "Retur", dibatalkan: "Dibatalkan",
};

export interface StatusGlossaryRow { key: string; internal: string; arti: string; marketplace: string; }
export const STATUS_GLOSSARY: StatusGlossaryRow[] = [
  { key: "masuk", internal: "Menunggu Disetujui", arti: "Order baru berbayar, menunggu Anda setujui.", marketplace: "= status di marketplace" },
  { key: "approved", internal: "Menunggu Dicetak", arti: "Sudah disetujui, resi belum diunduh.", marketplace: "di marketplace: masih Siap Kirim" },
  { key: "packing", internal: "Menunggu Dipacking", arti: "Resi sudah diunduh, belum discan tim packing.", marketplace: "di marketplace: masih Siap Kirim" },
  { key: "siap_kirim", internal: "Menunggu Dipickup", arti: "Sudah discan packing, menunggu diambil kurir.", marketplace: "di marketplace: masih Siap Kirim" },
  { key: "dikirim", internal: "Dalam Pengiriman", arti: "Diambil kurir / dalam perjalanan.", marketplace: "= status di marketplace" },
];
