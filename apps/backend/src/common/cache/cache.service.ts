import { Injectable } from "@nestjs/common";

/**
 * Cache TTL in-memory sederhana untuk endpoint agregasi mahal (mis. dashboard).
 *
 * Backend berjalan single-instance (pm2 fork), jadi cache di-proses ini cukup
 * dan setara Redis untuk kebutuhan ini — tanpa dependency/infra tambahan. Kalau
 * nanti diskalakan ke banyak instance, cukup ganti implementasi kelas ini ke
 * klien Redis (antarmuka get/set/wrap tetap sama).
 */
@Injectable()
export class CacheService {
  private store = new Map<string, { v: unknown; exp: number }>();

  get<T>(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.exp) {
      this.store.delete(key);
      return undefined;
    }
    return e.v as T;
  }

  set(key: string, v: unknown, ttlMs: number): void {
    this.store.set(key, { v, exp: Date.now() + ttlMs });
    if (this.store.size > 5000) this.prune();
  }

  /** Ambil dari cache; kalau kosong/expired, jalankan fn lalu simpan. */
  async wrap<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const v = await fn();
    this.set(key, v, ttlMs);
    return v;
  }

  del(prefix: string): void {
    for (const k of this.store.keys()) if (k.startsWith(prefix)) this.store.delete(k);
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, e] of this.store) if (now > e.exp) this.store.delete(k);
  }
}
