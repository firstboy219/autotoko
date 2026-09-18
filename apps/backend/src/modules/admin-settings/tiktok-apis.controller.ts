import { Controller, Get, UseGuards } from "@nestjs/common";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, AdminOnly } from "../auth/jwt-auth.guard.js";
import { TIKTOK_API_CATALOG } from "./tiktok-api-catalog.js";

/**
 * Katalog SEMUA endpoint TikTok Shop OpenAPI + tanda DIPAKAI/tidak yang
 * TER-UPDATE OTOMATIS: flag `used` dihitung dgn memindai kode backend yang
 * benar-benar ter-deploy (folder dist) untuk tiap path endpoint. Jadi begitu
 * sebuah API mulai/berhenti dipakai di source code, statusnya ikut berubah
 * tanpa edit manual. `feature`/`purpose` (untuk apa) tetap dari peta kurasi.
 */

// Peta kurasi: fitur + fungsi utk endpoint yang kita pakai. Key = "METHOD normPath"
// (placeholder {..} -> {}). codeHint = string alternatif utk endpoint yg path-nya
// dibangun dinamis di kode (mis. /api/v2/token/${mode}).
const FEATURE_MAP: Record<string, { feature: string; purpose: string; codeHint?: string }> = {
  "GET /api/v2/token/get": { feature: "Koneksi toko", purpose: "Tukar authorization code jadi access token.", codeHint: "/api/v2/token" },
  "GET /api/v2/token/refresh": { feature: "Auto-refresh token", purpose: "Perpanjang access token kadaluarsa utk semua sync.", codeHint: "/api/v2/token" },
  "GET /authorization/202309/shops": { feature: "Koneksi toko", purpose: "Ambil daftar toko terotorisasi + shop cipher.", codeHint: "/authorization/" },
  "POST /order/202309/orders/search": { feature: "Sinkron Order", purpose: "Cari & tarik pesanan masuk." },
  "GET /order/202407/orders/{}/price_detail": { feature: "Est. Pencairan Order", purpose: "Rincian harga/diskon/pajak per order (basis estimasi pencairan net)." },
  "POST /product/202309/products/search": { feature: "Sinkron Produk", purpose: "Tarik daftar produk toko." },
  "GET /product/202309/products/{}": { feature: "Sinkron Produk", purpose: "Detail produk + varian." },
  "POST /product/202309/products/{}/partial_edit": { feature: "Push SKU", purpose: "Update seller SKU produk ke TikTok." },
  "PUT /product/202309/products/{}": { feature: "Master Produk", purpose: "Update penuh produk ke TikTok." },
  "POST /return_refund/202309/returns/search": { feature: "Retur & Refund", purpose: "Daftar retur/refund pembeli." },
  "GET /finance/202309/statements": { feature: "Audit & Pencairan", purpose: "Daftar statement settlement." },
  "GET /finance/202309/statements/{}/statement_transactions": { feature: "Audit Pesanan", purpose: "Rincian potongan/settlement per order." },
  "GET /finance/202309/withdrawals": { feature: "Saldo & Pencairan", purpose: "Ledger penarikan/settle/transfer (saldo bisa ditarik + import withdraw)." },
  "GET /finance/202309/payments": { feature: "Pencairan Dana", purpose: "Daftar pembayaran/payout." },
  "GET /fulfillment/202309/packages/{}/handover_time_slots": { feature: "Jadwal Jemput", purpose: "Slot jemput sameday/instant." },
  "GET /fulfillment/202309/packages/{}/shipping_documents": { feature: "Cetak Resi", purpose: "Unduh PDF label/AWB + packing slip." },
  "POST /fulfillment/202309/packages/{}/ship": { feature: "Cetak Resi", purpose: "Generate resi/AWB (ship package / RTS)." },
  "GET /fulfillment/202309/orders/{}/tracking": { feature: "Tracking Order", purpose: "Linimasa pengiriman order." },
  "GET /customer_service/202309/conversations": { feature: "Chat Pelanggan", purpose: "Sinkron daftar percakapan chat." },
  "POST /customer_service/202309/conversations": { feature: "Chat Pelanggan", purpose: "Mulai percakapan dari order (buyer user id)." },
  "GET /customer_service/202309/conversations/{}/messages": { feature: "Chat Pelanggan", purpose: "Tarik pesan dalam percakapan." },
  "POST /customer_service/202309/conversations/{}/messages": { feature: "Chat Pelanggan", purpose: "Kirim balasan ke pembeli." },
  "POST /customer_service/202309/conversations/{}/messages/read": { feature: "Chat Pelanggan", purpose: "Tandai percakapan dibaca." },
  "POST /promotion/202309/activities/search": { feature: "Promosi", purpose: "Daftar activity (flash sale/diskon) per toko." },
  "GET /promotion/202309/activities/{}": { feature: "Promosi", purpose: "Detail activity + produk di dalamnya." },
  "POST /promotion/202309/activities": { feature: "Promosi", purpose: "Buat activity promo baru." },
  "PUT /promotion/202309/activities/{}": { feature: "Promosi", purpose: "Ubah activity (judul/waktu)." },
  "POST /promotion/202309/activities/{}/deactivate": { feature: "Promosi", purpose: "Nonaktifkan activity." },
  "PUT /promotion/202309/activities/{}/products": { feature: "Promosi", purpose: "Tambah produk + diskon ke activity." },
  "DELETE /promotion/202309/activities/{}/products": { feature: "Promosi", purpose: "Hapus produk dari activity." },
  "POST /promotion/202406/coupons/search": { feature: "Promosi", purpose: "Daftar coupon per toko." },
  "GET /promotion/202406/coupons/{}": { feature: "Promosi", purpose: "Detail coupon (threshold, diskon, kode, kuota)." },
};

const normKey = (method: string, path: string) => `${method} ${path.replace(/\{[^}]+\}/g, "{}")}`;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Regex path: bagian statis literal, placeholder -> satu segmen (tanpa '/'),
// diakhiri batas string (kutip/backtick/?) supaya tak salah-cocok dgn path yg
// lebih panjang yang berbagi prefix.
function usedRegex(path: string): RegExp {
  const parts = path.split(/\{[^}]+\}/).map(escapeRe);
  const body = parts.join("[^\"'`/\\s]+");
  return new RegExp(body + "(?=[\"'`?])");
}

let cache: { at: number; blob: string } | null = null;
function distBlob(): string {
  if (cache && Date.now() - cache.at < 5 * 60 * 1000) return cache.blob;
  // Compiled to CommonJS, so __dirname = <dist>/modules/admin-settings.
  const distRoot = join(__dirname, "..", "..");
  const parts: string[] = [];
  const walk = (d: string) => {
    let ents: string[];
    try { ents = readdirSync(d); } catch { return; }
    for (const e of ents) {
      const fp = join(d, e);
      let st;
      try { st = statSync(fp); } catch { continue; }
      if (st.isDirectory()) { if (e !== "node_modules") walk(fp); }
      // JANGAN pindai file data katalog & controller ini sendiri — keduanya memuat
      // SEMUA string path sbg data/kurasi, yang akan bikin semua endpoint ke-flag dipakai.
      else if (e.endsWith(".js") && e !== "tiktok-api-catalog.js" && e !== "tiktok-apis.controller.js") {
        try { parts.push(readFileSync(fp, "utf8")); } catch { /* skip */ }
      }
    }
  };
  walk(distRoot);
  cache = { at: Date.now(), blob: parts.join("\n") };
  return cache.blob;
}

@Controller("admin/tiktok-apis")
@UseGuards(JwtAuthGuard)
@AdminOnly()
export class TiktokApisController {
  @Get()
  list(): ApiResponse<unknown> {
    const blob = distBlob();
    const catalog = TIKTOK_API_CATALOG.map((e) => {
      const key = normKey(e.method, e.path);
      const cur = FEATURE_MAP[key];
      const byPath = usedRegex(e.path).test(blob);
      const byHint = cur?.codeHint ? blob.includes(cur.codeHint) : false;
      const used = byPath || byHint;
      return {
        category: e.category,
        cat: e.cat,
        method: e.method,
        path: e.path,
        name: e.name,
        desc: e.desc,
        used,
        feature: used ? cur?.feature ?? "Terdeteksi dipakai" : "",
        purpose: used ? cur?.purpose ?? "Endpoint ini dipanggil oleh kode backend AutoToko." : "",
      };
    });
    const usedCount = catalog.filter((c) => c.used).length;
    return {
      success: true,
      data: {
        catalog,
        stats: { total: catalog.length, used: usedCount },
        autoDetected: true,
        scannedAt: new Date(cache?.at ?? Date.now()).toISOString(),
      },
    };
  }
}
