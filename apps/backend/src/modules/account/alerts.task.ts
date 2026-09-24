import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { and, eq, lt, lte, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { TenantService } from "../../database/tenant.service.js";
import { bomItems, masterProducts, shops, users, wallets } from "../../database/schema/index.js";
import { NotificationService } from "./notification.service.js";

const WALLET_LOW = 150_000; // IDR
const TOKEN_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 hari

/**
 * Alert proaktif harian.
 *
 * Dashboard sudah menghitung "saldo rendah / token mau habis / stok menipis",
 * tapi hanya saat halaman dibuka. Cron ini mendorongnya ke feed notifikasi
 * (NotifBell APK + halaman Notifikasi web) supaya sampai walau seller tidak
 * sedang membuka dashboard. Read-only + dedupe 20 jam (tak spam).
 */
@Injectable()
export class AlertsTask {
  private readonly logger = new Logger(AlertsTask.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly tenant: TenantService,
    private readonly notif: NotificationService,
  ) {}

  @Cron("0 8 * * *", { timeZone: "Asia/Jakarta" })
  async harian(): Promise<void> {
    try {
      await this.tenant.runBypass(async () => {
        const us = await this.db.select({ id: users.id }).from(users);
        let n = 0;
        for (const u of us) n += await this.forUser(u.id);
        if (n > 0) this.logger.log(`Alert proaktif: ${n} notifikasi ditulis untuk ${us.length} user`);
      });
    } catch (e) {
      this.logger.error(`Alert task gagal: ${(e as Error).message}`);
    }
  }

  private async forUser(userId: string): Promise<number> {
    let n = 0;

    // Saldo wallet rendah.
    const [w] = await this.db
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .limit(1);
    const bal = Number(w?.balance ?? 0);
    if (bal < WALLET_LOW) {
      if (
        await this.notif.write({
          userId,
          type: "low_wallet",
          title: "Saldo wallet menipis",
          message: `Saldo Rp${bal.toLocaleString("id-ID")} di bawah Rp${WALLET_LOW.toLocaleString("id-ID")}. Isi ulang agar fitur berbayar & otomasi tetap berjalan.`,
        })
      )
        n++;
    }

    // Token toko mendekati kedaluwarsa (jaring pengaman bila auto-refresh gagal).
    const cutoff = new Date(Date.now() + TOKEN_WINDOW_MS);
    const exp = await this.db
      .select({ nama: sql<string>`coalesce(${shops.displayName}, ${shops.shopName})` })
      .from(shops)
      .where(
        and(
          eq(shops.userId, userId),
          eq(shops.shopStatus, "active"),
          lt(shops.accessTokenExpireAt, cutoff),
        ),
      );
    if (exp.length > 0) {
      if (
        await this.notif.write({
          userId,
          type: "token_expiring",
          title: "Koneksi toko perlu diperbarui",
          message: `${exp.length} toko tokennya mendekati kedaluwarsa: ${exp.map((e) => e.nama).join(", ")}. Buka menu Toko → Refresh Token bila perlu.`,
        })
      )
        n++;
    }

    // Stok bahan menipis.
    const low = await this.db
      .select({ nama: bomItems.materialName })
      .from(bomItems)
      .innerJoin(masterProducts, eq(bomItems.masterProductId, masterProducts.id))
      .where(and(eq(masterProducts.userId, userId), lte(bomItems.currentStock, bomItems.minimumThreshold)));
    if (low.length > 0) {
      if (
        await this.notif.write({
          userId,
          type: "low_stock",
          title: "Stok bahan menipis",
          message: `${low.length} bahan di bawah ambang minimum: ${low.slice(0, 5).map((r) => r.nama).join(", ")}${low.length > 5 ? ", dll" : ""}.`,
        })
      )
        n++;
    }

    return n;
  }
}
