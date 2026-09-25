import { signTikTok, unixNow } from "../../marketplace/signing/tiktok.signer.js";

const BASE = "https://open-api.tiktokglobalshop.com";

/**
 * Galat dari TikTok, dengan kode mereka. Dibedakan dari galat jaringan supaya
 * pemanggil bisa memutuskan: kode token -> segarkan lalu ulangi sekali; kode
 * lain -> catat dan berhenti. Mengulang tanpa pandang bulu pada "invalid
 * parameter" hanya membuat log penuh dengan kegagalan yang sama.
 */
export class TikTokApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly httpStatus: number,
    readonly path: string,
  ) {
    super(`TikTok ${path}: [${code}] ${message}`);
  }

  /**
   * Token tidak sah atau kedaluwarsa. Kodenya dari pengalaman, bukan daftar
   * resmi yang lengkap, jadi pesan yang menyebut token juga dihitung -- lebih
   * baik menyegarkan sekali percuma daripada gagal karena kode baru.
   */
  get tokenBermasalah(): boolean {
    // 105005 = scope app belum diberikan. Pesannya menyebut "new access
    // token" sehingga dulu terbaca sebagai token rusak -> refresh sia-sia.
    if (this.code === 105005) return false;
    return [105000, 105001, 105002, 36004002, 36004004].includes(this.code)
      || /access[_ ]token|token (is )?(invalid|expired)/i.test(this.message);
  }
}

export interface Halaman<T> {
  data: T[];
  nextPageToken: string | null;
  totalCount: number | null;
}

/**
 * Satu klien untuk satu toko: memegang app key/secret, token akses, dan
 * shop_cipher, lalu menandatangani tiap permintaan.
 *
 * Tidak ada penyimpanan di sini. Klien dibuat per run dari token yang
 * disimpan (terenkripsi) dan dibuang sesudahnya; menyegarkan token adalah
 * urusan pemanggil, yang tahu cara menyimpannya kembali.
 */
export class TikTokClient {
  constructor(
    private readonly appKey: string,
    private readonly appSecret: string,
    private accessToken: string,
    private readonly shopCipher: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Dipanggil pemanggil setelah menyegarkan token, supaya klien lanjut. */
  gantiToken(token: string): void {
    this.accessToken = token;
  }

  async post<T = unknown>(
    path: string,
    body: Record<string, unknown>,
    query: Record<string, string | number> = {},
  ): Promise<T> {
    return this.kirim<T>("POST", path, query, body);
  }

  async get<T = unknown>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    return this.kirim<T>("GET", path, query, undefined);
  }

  async put<T = unknown>(path: string, body: Record<string, unknown>, query: Record<string, string | number> = {}): Promise<T> {
    return this.kirim<T>("PUT", path, query, body);
  }

  async del<T = unknown>(path: string, body?: Record<string, unknown>, query: Record<string, string | number> = {}): Promise<T> {
    return this.kirim<T>("DELETE", path, query, body);
  }

  private async kirim<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    query: Record<string, string | number>,
    body: Record<string, unknown> | undefined,
  ): Promise<T> {
    const q: Record<string, string | number> = {
      ...query,
      app_key: this.appKey,
      timestamp: unixNow(),
    };
    if (this.shopCipher && q.shop_cipher == null) q.shop_cipher = this.shopCipher;
    // Body harus persis string yang dikirim: tanda tangan dihitung atas
    // teksnya, dan spasi atau urutan kunci yang berbeda menggagalkannya.
    const bodyStr = body === undefined ? undefined : JSON.stringify(body);
    q.sign = signTikTok({ appSecret: this.appSecret, path, query: q, body: bodyStr });

    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])),
    ).toString();

    const res = await this.fetchImpl(`${BASE}${path}?${qs}`, {
      method,
      headers: {
        "x-tts-access-token": this.accessToken,
        "content-type": "application/json",
      },
      body: bodyStr,
    });

    const teks = await res.text();
    let json: { code?: number; message?: string; data?: T } = {};
    try {
      json = teks ? JSON.parse(teks) : {};
    } catch {
      throw new TikTokApiError(-1, `balasan bukan JSON (HTTP ${res.status}): ${teks.slice(0, 120)}`, res.status, path);
    }
    if (json.code !== 0) {
      throw new TikTokApiError(json.code ?? -1, json.message ?? `HTTP ${res.status}`, res.status, path);
    }
    return json.data as T;
  }

  /* ---------------------------------------------------------- endpoint */

  /**
   * Pesanan yang berubah dalam rentang, diurutkan dari yang terlama berubah.
   *
   * Diurutkan naik menurut update_time SENGAJA: kalau run terputus di tengah,
   * watermark yang tercatat adalah yang terbesar dari yang sudah tersimpan,
   * dan run berikutnya melanjutkan dari situ tanpa lubang. Urutan turun
   * membuat lubang di tengah yang tidak akan pernah terisi.
   */
  async cariPesanan(opts: {
    updateTimeGe?: number;
    updateTimeLt?: number;
    pageToken?: string | null;
    pageSize?: number;
  }): Promise<Halaman<Record<string, unknown>>> {
    const body: Record<string, unknown> = {};
    if (opts.updateTimeGe != null) body.update_time_ge = opts.updateTimeGe;
    if (opts.updateTimeLt != null) body.update_time_lt = opts.updateTimeLt;
    const query: Record<string, string | number> = {
      page_size: Math.min(100, Math.max(1, opts.pageSize ?? 100)),
      sort_field: "update_time",
      sort_order: "ASC",
    };
    if (opts.pageToken) query.page_token = opts.pageToken;
    const d = await this.post<{
      orders?: Record<string, unknown>[];
      next_page_token?: string;
      total_count?: number;
    }>("/order/202309/orders/search", body, query);
    return {
      data: d?.orders ?? [],
      nextPageToken: d?.next_page_token || null,
      totalCount: d?.total_count ?? null,
    };
  }

  async cariProduk(opts: {
    pageToken?: string | null;
    pageSize?: number;
  }): Promise<Halaman<Record<string, unknown>>> {
    const query: Record<string, string | number> = {
      page_size: Math.min(100, Math.max(1, opts.pageSize ?? 100)),
    };
    if (opts.pageToken) query.page_token = opts.pageToken;
    const d = await this.post<{
      products?: Record<string, unknown>[];
      next_page_token?: string;
      total_count?: number;
    }>("/product/202309/products/search", { status: "ACTIVATE" }, query);
    return {
      data: d?.products ?? [],
      nextPageToken: d?.next_page_token || null,
      totalCount: d?.total_count ?? null,
    };
  }

  /* -------------------------------------------------- finance 202309 */

  /**
   * Daftar statement (penyelesaian) toko, diurut waktu terbaru. Rentang waktu
   * opsional dalam unix detik. Ini padanan API dari mengunggah berkas laporan
   * penyelesaian: tiap statement mengelompokkan transaksi satu periode payout.
   */
  async daftarStatement(opts: {
    statementTimeGe?: number;
    statementTimeLt?: number;
    pageToken?: string | null;
    pageSize?: number;
  }): Promise<Halaman<Record<string, unknown>>> {
    const query: Record<string, string | number> = {
      page_size: Math.min(100, Math.max(1, opts.pageSize ?? 100)),
      sort_field: "statement_time",
      sort_order: "DESC",
    };
    if (opts.statementTimeGe != null) query.statement_time_ge = opts.statementTimeGe;
    if (opts.statementTimeLt != null) query.statement_time_lt = opts.statementTimeLt;
    if (opts.pageToken) query.page_token = opts.pageToken;
    const d = await this.get<{
      statements?: Record<string, unknown>[];
      next_page_token?: string;
      total_count?: number;
    }>("/finance/202309/statements", query);
    return {
      data: d?.statements ?? [],
      nextPageToken: d?.next_page_token || null,
      totalCount: d?.total_count ?? null,
    };
  }

  /**
   * Transaksi (per pesanan / penyesuaian) di dalam satu statement. Tiap baris
   * memuat order_id + settlement_amount: inilah "berapa sebenarnya cair per
   * pesanan" yang dipakai Audit Pesanan sumber API.
   */
  async transaksiStatement(
    statementId: string,
    opts: { pageToken?: string | null; pageSize?: number } = {},
  ): Promise<Halaman<Record<string, unknown>>> {
    const query: Record<string, string | number> = {
      page_size: Math.min(100, Math.max(1, opts.pageSize ?? 100)),
      sort_field: "order_create_time",
    };
    if (opts.pageToken) query.page_token = opts.pageToken;
    const d = await this.get<{
      statement_transactions?: Record<string, unknown>[];
      next_page_token?: string;
      total_count?: number;
    }>(`/finance/202309/statements/${statementId}/statement_transactions`, query);
    return {
      data: d?.statement_transactions ?? [],
      nextPageToken: d?.next_page_token || null,
      totalCount: d?.total_count ?? null,
    };
  }

  /**
   * Mutasi saldo Finance TikTok (Get Withdrawals): SETTLE = uang masuk ke saldo,
   * WITHDRAW = uang ditarik keluar, TRANSFER/REVERSE = penyesuaian. TikTok TIDAK
   * punya endpoint "saldo bisa ditarik" langsung, jadi saldo direkonstruksi dari
   * ledger ini: kira-kira Σ(SETTLE) - Σ(WITHDRAW).
   */
  async daftarWithdrawal(
    opts: { pageToken?: string | null; pageSize?: number; createTimeGe?: number; createTimeLt?: number } = {},
  ): Promise<Halaman<Record<string, unknown>>> {
    const query: Record<string, string | number> = {
      page_size: Math.min(100, Math.max(1, opts.pageSize ?? 100)),
      types: "WITHDRAW,SETTLE,TRANSFER,REVERSE",
      sort_field: "create_time",
    };
    if (opts.createTimeGe != null) query.create_time_ge = opts.createTimeGe;
    if (opts.createTimeLt != null) query.create_time_lt = opts.createTimeLt;
    if (opts.pageToken) query.page_token = opts.pageToken;
    const d = await this.get<{
      withdrawals?: Record<string, unknown>[];
      next_page_token?: string;
      total_count?: number;
    }>("/finance/202309/withdrawals", query);
    return {
      data: d?.withdrawals ?? [],
      nextPageToken: d?.next_page_token || null,
      totalCount: d?.total_count ?? null,
    };
  }

  /** Get Payments 202309: catatan payout/pembayaran ke seller. */
  async daftarPayment(
    opts: { pageToken?: string | null; pageSize?: number; createTimeGe?: number; createTimeLt?: number } = {},
  ): Promise<Halaman<Record<string, unknown>>> {
    const query: Record<string, string | number> = {
      page_size: Math.min(100, Math.max(1, opts.pageSize ?? 100)),
      sort_field: "create_time",
    };
    if (opts.createTimeGe != null) query.create_time_ge = opts.createTimeGe;
    if (opts.createTimeLt != null) query.create_time_lt = opts.createTimeLt;
    if (opts.pageToken) query.page_token = opts.pageToken;
    const d = await this.get<{ payments?: Record<string, unknown>[]; next_page_token?: string; total_count?: number }>(
      "/finance/202309/payments", query);
    return { data: d?.payments ?? [], nextPageToken: d?.next_page_token || null, totalCount: d?.total_count ?? null };
  }

  /** Slot jadwal jemput (pickup) untuk sebuah paket sameday/instant. */
  /* -------------------------------------------------- promotion 202309/202406 */
  async promoSearchActivities(body: Record<string, unknown>) {
    return this.post<Record<string, unknown>>("/promotion/202309/activities/search", body);
  }
  async promoGetActivity(id: string) {
    return this.get<Record<string, unknown>>(`/promotion/202309/activities/${id}`);
  }
  async promoCreateActivity(body: Record<string, unknown>) {
    return this.post<Record<string, unknown>>("/promotion/202309/activities", body);
  }
  async promoUpdateActivity(id: string, body: Record<string, unknown>) {
    return this.put<Record<string, unknown>>(`/promotion/202309/activities/${id}`, body);
  }
  async promoDeactivateActivity(id: string) {
    return this.post<Record<string, unknown>>(`/promotion/202309/activities/${id}/deactivate`, {});
  }
  async promoUpdateProducts(id: string, products: Array<Record<string, unknown>>) {
    return this.put<Record<string, unknown>>(`/promotion/202309/activities/${id}/products`, { activity_id: id, products });
  }
  async promoRemoveProducts(id: string, productIds: string[]) {
    return this.del<Record<string, unknown>>(`/promotion/202309/activities/${id}/products`, { activity_id: id, product_ids: productIds });
  }
  async promoSearchCoupons(body: Record<string, unknown>) {
    return this.post<Record<string, unknown>>("/promotion/202406/coupons/search", body);
  }
  async promoGetCoupon(id: string) {
    return this.get<Record<string, unknown>>(`/promotion/202406/coupons/${id}`);
  }

  /** Get Price Detail 202407: rincian harga per order (basis "estimasi pencairan"). */
  async priceDetail(orderId: string) {
    return this.get<Record<string, unknown>>(`/order/202407/orders/${orderId}/price_detail`);
  }

  /** Get Order Detail 202309: status beberapa order sekaligus (maks ~50 id). */
  async ordersByIds(ids: string[]) {
    return this.get<{ orders?: Record<string, unknown>[] }>("/order/202309/orders", { ids: ids.join(",") });
  }

  /**
   * Batalkan order (seller) via Cancellation API 202309.
   * CATATAN: kontrak persis (reason_key/line items) perlu diverifikasi saat
   * scope Return/Refund aktif; sebelum itu panggilan ditolak & ditangani
   * graceful oleh pemanggil (order tetap ditandai batal di AutoToko).
   */
  async cancelOrder(orderId: string, reasonKey: string) {
    // cancel_reason WAJIB berupa kunci enum resmi TikTok (mis. "out_of_stock"),
    // bukan teks bebas — teks bebas ditolak [25001014] Unknown reason.
    return this.post("/return_refund/202309/cancellations", {}, {
      order_id: orderId,
      cancel_reason: reasonKey,
    });
  }

  /**
   * Cari riwayat pembatalan (90 hari) — dipakai untuk MEMPELAJARI cancel_reason
   * yang TERBUKTI diterima TikTok di toko ini (termasuk yang dibatalkan manual
   * di Seller Center), bukan menebak dari dokumentasi. Read-only.
   */
  async searchCancellations(sinceSec: number) {
    return this.post<Record<string, unknown>>(
      "/return_refund/202309/cancellations/search",
      { create_time_ge: sinceSec },
      { page_size: 50, sort_field: "create_time", sort_order: "DESC" },
    );
  }

  /** Get Tracking 202309: linimasa pengiriman sebuah order. */
  async orderTracking(orderId: string) {
    return this.get<{ tracking?: Array<Record<string, unknown>> }>(
      `/fulfillment/202309/orders/${orderId}/tracking`,
    );
  }

  async slotJemput(packageId: string): Promise<{
    can_drop_off?: boolean;
    can_pickup?: boolean;
    can_van_collection?: boolean;
    drop_off_point_url?: string;
    pickup_slots?: { avaliable?: boolean; start_time?: number; end_time?: number }[];
  }> {
    return this.get(`/fulfillment/202309/packages/${packageId}/handover_time_slots`);
  }
}
