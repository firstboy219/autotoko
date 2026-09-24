import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, gt } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { notifications } from "../../database/schema/index.js";

/**
 * Penulis notifikasi in-app untuk seller.
 *
 * Tabel `notifications` sudah lama ada tapi belum ada yang menulis ke sana --
 * alert dulu hanya dihitung saat dashboard dibuka, jadi hilang kalau orangnya
 * tak sedang menatap layar. Service ini "mendorong" (push) kejadian penting ke
 * feed notifikasi (NotifBell APK + halaman Notifikasi web).
 *
 * Dipakai lintas fitur: alert proaktif (saldo/token/stok), review yang butuh
 * perhatian, selisih rekonsiliasi, milestone pengiriman, dll.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Best-effort (tak pernah melempar). Dedupe: lewati kalau sudah ada
   * notifikasi dengan type+title sama untuk user ini dalam `dedupeHours`
   * terakhir, supaya alert berkala tak jadi spam. Balik true kalau ditulis.
   */
  async write(input: {
    userId: string;
    type: string;
    title: string;
    message: string;
    channel?: "in_app" | "email" | "wa";
    dedupeHours?: number;
  }): Promise<boolean> {
    try {
      const channel = input.channel ?? "in_app";
      const dedupeHours = input.dedupeHours ?? 20;
      const since = new Date(Date.now() - dedupeHours * 3600 * 1000);
      const [dup] = await this.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, input.userId),
            eq(notifications.type, input.type),
            eq(notifications.title, input.title),
            gt(notifications.createdAt, since),
          ),
        )
        .limit(1);
      if (dup) return false;
      await this.db.insert(notifications).values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        channel,
        // in_app langsung "tampil" di feed; email/wa nunggu pengirimnya masing-masing.
        sent: channel === "in_app",
      });
      return true;
    } catch (e) {
      this.logger.warn(`Gagal menulis notifikasi: ${(e as Error).message}`);
      return false;
    }
  }
}
