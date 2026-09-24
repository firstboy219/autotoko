import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { TenantService } from "../../database/tenant.service.js";
import { marketplaceConversations, marketplaceReturns, shops } from "../../database/schema/index.js";
import { NotificationService } from "../account/notification.service.js";
import { MarketplaceSyncService } from "./marketplace-sync.service.js";

/**
 * Auto-sync komunikasi & retur + beri tahu seller.
 *
 * `syncChat`/`syncReturns` sudah ada tapi dulu hanya manual (tombol). Cron ini
 * menariknya berkala lalu MENDORONG notifikasi ("chat belum dibalas", "retur
 * butuh tindakan") ke feed (NotifBell APK + Notifikasi web) lewat
 * NotificationService.
 *
 * Aman apa adanya: kalau scope Customer Service / Return TikTok belum aktif,
 * penarikan ditolak & di-catch (dorman, tak spam). Begitu scope diaktifkan di
 * Partner Center, otomasi ini langsung "menyala" tanpa perubahan kode.
 */
@Injectable()
export class CommsSyncTask {
  private readonly logger = new Logger(CommsSyncTask.name);
  private sedangJalan = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly tenant: TenantService,
    private readonly sync: MarketplaceSyncService,
    private readonly notif: NotificationService,
  ) {}

  @Cron("*/30 * * * *", { timeZone: "Asia/Jakarta" })
  async jalan(): Promise<void> {
    if (this.sedangJalan) return;
    this.sedangJalan = true;
    try {
      const users = await this.tenant.runBypass(() =>
        this.db
          .selectDistinct({ id: shops.userId })
          .from(shops)
          .where(and(eq(shops.marketplace, "tiktok"), eq(shops.shopStatus, "active"))),
      );
      let notif = 0;
      for (const u of users) notif += await this.perUser(u.id);
      if (notif > 0) this.logger.log(`Comms sync: ${notif} notifikasi untuk ${users.length} user`);
    } catch (e) {
      this.logger.error(`Comms sync gagal: ${(e as Error).message}`);
    } finally {
      this.sedangJalan = false;
    }
  }

  private async perUser(userId: string): Promise<number> {
    // Tarik — graceful. Dorman sampai scope aktif; penolakan tidak boleh
    // menghentikan user lain atau membuat log berisik.
    try { await this.sync.syncChat(userId); } catch { /* scope CS belum aktif */ }
    try { await this.sync.syncReturns(userId); } catch { /* scope retur belum aktif */ }

    return this.tenant.runBypass(async () => {
      let n = 0;

      const [chat] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(marketplaceConversations)
        .where(and(eq(marketplaceConversations.userId, userId), gt(marketplaceConversations.unread, 0)));
      const unread = Number(chat?.n ?? 0);
      if (unread > 0) {
        // Dedupe 6 jam: boleh menyenggol beberapa kali sehari, tapi tak tiap 30 menit.
        if (await this.notif.write({
          userId,
          type: "chat_unread",
          title: "Chat pembeli belum dibalas",
          message: `${unread} percakapan menunggu balasan. Buka menu Chat untuk merespons.`,
          dedupeHours: 6,
        })) n++;
      }

      const [ret] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(marketplaceReturns)
        .where(and(eq(marketplaceReturns.userId, userId), isNotNull(marketplaceReturns.sellerNextAction)));
      const pending = Number(ret?.n ?? 0);
      if (pending > 0) {
        if (await this.notif.write({
          userId,
          type: "retur_aksi",
          title: "Retur menunggu tindakan",
          message: `${pending} retur butuh keputusan (setujui/tolak) sebelum deadline. Buka menu Retur.`,
        })) n++;
      }

      return n;
    });
  }
}
