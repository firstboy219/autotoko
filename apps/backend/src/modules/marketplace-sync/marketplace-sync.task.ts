import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MarketplaceSyncService } from "./marketplace-sync.service.js";

/**
 * Sinkronisasi berkala.
 *
 * Pesanan tiap 15 menit: cukup rapat untuk gudang yang menunggu pesanan
 * masuk, cukup renggang untuk tidak menabrak batas laju TikTok pada tiga toko
 * sekaligus. Produk tiap 6 jam: katalog berubah per hari, bukan per menit.
 *
 * Service membungkus tiap sentuhan DB dengan bypass-nya sendiri (cron tidak
 * punya sesi pengguna, dan tanpa bypass RLS diam-diam mengembalikan nol baris
 * -- jebakan yang sudah memakan lima korban di proyek ini). Task tidak
 * membungkus apa pun: satu transaksi panjang mengelilingi 91 panggilan HTTP
 * justru hal yang sengaja dihindari.
 *
 * Kunci sederhana mencegah dua run bertumpuk kalau satu run lebih lama
 * dari intervalnya (toko besar, jaringan lambat).
 */
@Injectable()
export class MarketplaceSyncTask {
  private readonly logger = new Logger(MarketplaceSyncTask.name);
  private sedangJalan = false;

  constructor(private readonly sync: MarketplaceSyncService) {}

  @Cron("*/15 * * * *", { timeZone: "Asia/Jakarta" })
  async pesanan(): Promise<void> {
    if (this.sedangJalan) {
      this.logger.warn("Sync pesanan dilewati: run sebelumnya masih berjalan");
      return;
    }
    this.sedangJalan = true;
    try {
      const h = await this.sync.syncSemua("orders", "cron");
      this.logger.log(`Sync pesanan: ${h.toko} toko, ${h.gagal} gagal`);
    } catch (e) {
      this.logger.error(`Sync pesanan gagal: ${(e as Error).message}`);
    } finally {
      this.sedangJalan = false;
    }
  }

  @Cron("5 */6 * * *", { timeZone: "Asia/Jakarta" })
  async produk(): Promise<void> {
    try {
      const h = await this.sync.syncSemua("products", "cron");
      this.logger.log(`Sync produk: ${h.toko} toko, ${h.gagal} gagal`);
    } catch (e) {
      this.logger.error(`Sync produk gagal: ${(e as Error).message}`);
    }
  }
}
