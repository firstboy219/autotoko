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

  private async kirim<T>(
    method: "GET" | "POST",
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
    }>("/product/202309/products/search", {}, query);
    return {
      data: d?.products ?? [],
      nextPageToken: d?.next_page_token || null,
      totalCount: d?.total_count ?? null,
    };
  }
}
