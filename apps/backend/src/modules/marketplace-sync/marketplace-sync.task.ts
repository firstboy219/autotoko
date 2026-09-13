import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MarketplaceSyncService } from "./marketplace-sync.service.js";

/**
 * Sinkronisasi berkala.
 *
 * Pesanan tiap 2 menit: itulah "realtime tanpa klik" -- tiap run yang tidak
 * menemukan perubahan hanyalah satu panggilan API murah per toko (bertahap
 * lewat watermark), dan run yang menemukan pesanan baru langsung mendorongnya
 * ke dashboard lewat emit. Produk tiap 6 jam: katalog berubah per hari.
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

  @Cron("*/2 * * * *", { timeZone: "Asia/Jakarta" })
  async pesanan(): Promise<void> {
    if (this.sedangJalan) {
      // Wajar sesekali pada toko besar; tidak perlu diributkan tiap dua menit.
      return;
    }
    this.sedangJalan = true;
    try {
      const h = await this.sync.syncSemua("orders", "cron");
      // Diam saat tidak ada perubahan: pada irama dua menit, mencatat "0 baru"
      // 720 kali sehari hanya menenggelamkan baris yang benar-benar penting.
      if (h.upserted > 0 || h.gagal > 0) {
        this.logger.log(`Sync pesanan: ${h.upserted} baris, ${h.gagal} gagal, ${h.toko} toko`);
      }
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
