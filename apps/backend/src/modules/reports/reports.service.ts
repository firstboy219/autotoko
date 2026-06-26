import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, gte, lt, isNotNull, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { orders, shops, users } from "../../database/schema/index.js";
import { MailService } from "../../common/mail/mail.service.js";

export type ReportType = "daily" | "weekly" | "monthly";

interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

export interface Report {
  type: ReportType;
  range: { start: string; end: string; label: string };
  totals: { orders: number; revenue: number; platform_fee: number };
  by_shop: { shop: string; orders: number; revenue: number }[];
  by_status: { status: string; orders: number }[];
  top_products: { name: string; qty: number }[];
}

const JAK_OFFSET_MS = 7 * 3600 * 1000; // Asia/Jakarta = UTC+7, no DST

/**
 * Scheduled recap reports (PRD Bagian 8.9 / 6.9). Daily / weekly / monthly
 * aggregates emailed to each seller. Pure-data (no AI dependency) so it always
 * runs; cron times are in Asia/Jakarta.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly mail: MailService,
  ) {}

  /** Build a UTC Date from Jakarta-local Y/M/D (00:00 WIB). */
  private jakDate(y: number, m: number, d: number): Date {
    return new Date(Date.UTC(y, m, d) - JAK_OFFSET_MS);
  }

  /** "Now" expressed in Jakarta wall-clock fields. */
  private jakNow() {
    const j = new Date(Date.now() + JAK_OFFSET_MS);
    return { y: j.getUTCFullYear(), m: j.getUTCMonth(), d: j.getUTCDate(), dow: j.getUTCDay() };
  }

  rangeFor(type: ReportType): DateRange {
    const n = this.jakNow();
    if (type === "daily") {
      // Today so far (the cron fires at 23:55 WIB → effectively the whole day).
      const start = this.jakDate(n.y, n.m, n.d);
      return { start, end: new Date(), label: `Harian ${this.fmt(start)}` };
    }
    if (type === "weekly") {
      // Previous Mon–Sun. dow: 0=Sun..1=Mon.
      const daysSinceMon = (n.dow + 6) % 7;
      const thisMon = this.jakDate(n.y, n.m, n.d - daysSinceMon);
      const lastMon = new Date(thisMon.getTime() - 7 * 86400000);
      return { start: lastMon, end: thisMon, label: `Mingguan ${this.fmt(lastMon)}–${this.fmt(new Date(thisMon.getTime() - 86400000))}` };
    }
    // monthly: previous calendar month
    const thisMonth = this.jakDate(n.y, n.m, 1);
    const prevMonth = this.jakDate(n.m === 0 ? n.y - 1 : n.y, n.m === 0 ? 11 : n.m - 1, 1);
    return { start: prevMonth, end: thisMonth, label: `Bulanan ${this.fmtMonth(prevMonth)}` };
  }

  private fmt(d: Date): string {
    const j = new Date(d.getTime() + JAK_OFFSET_MS);
    return `${String(j.getUTCDate()).padStart(2, "0")}/${String(j.getUTCMonth() + 1).padStart(2, "0")}/${j.getUTCFullYear()}`;
  }
  private fmtMonth(d: Date): string {
    const j = new Date(d.getTime() + JAK_OFFSET_MS);
    const names = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    return `${names[j.getUTCMonth()]} ${j.getUTCFullYear()}`;
  }

  async buildReport(userId: string, type: ReportType): Promise<Report> {
    const range = this.rangeFor(type);
    const where = and(
      eq(orders.userId, userId),
      gte(orders.createdAt, range.start),
      lt(orders.createdAt, range.end),
    );

    const [tot] = await this.db
      .select({
        orders: sql<number>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${orders.totalAmount}), 0)`,
        fee: sql<string>`coalesce(sum(${orders.platformFee}), 0)`,
      })
      .from(orders)
      .where(where);

    const byShopRows = await this.db
      .select({
        shop: sql<string>`coalesce(${shops.shopName}, ${orders.marketplace})`,
        orders: sql<number>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${orders.totalAmount}), 0)`,
      })
      .from(orders)
      .leftJoin(shops, eq(orders.shopId, shops.id))
      .where(where)
      .groupBy(sql`coalesce(${shops.shopName}, ${orders.marketplace})`);

    const byStatusRows = await this.db
      .select({
        status: orders.fulfillmentStatus,
        orders: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(where)
      .groupBy(orders.fulfillmentStatus);

    // Top products from the order items JSON (best-effort; shapes vary by MP).
    const itemRows = await this.db
      .select({ items: orders.items })
      .from(orders)
      .where(where);
    const top_products = this.topProducts(itemRows.map((r) => r.items));

    return {
      type,
      range: { start: range.start.toISOString(), end: range.end.toISOString(), label: range.label },
      totals: {
        orders: tot?.orders ?? 0,
        revenue: Number(tot?.revenue ?? 0),
        platform_fee: Number(tot?.fee ?? 0),
      },
      by_shop: byShopRows.map((r) => ({ shop: r.shop, orders: r.orders, revenue: Number(r.revenue) })),
      by_status: byStatusRows.map((r) => ({ status: r.status, orders: r.orders })),
      top_products,
    };
  }

  private topProducts(itemsList: unknown[]): { name: string; qty: number }[] {
    const tally = new Map<string, number>();
    for (const items of itemsList) {
      const arr = Array.isArray(items) ? items : [];
      for (const it of arr as any[]) {
        const name =
          it?.product_name ?? it?.item_name ?? it?.name ?? it?.sku ?? it?.seller_sku;
        if (!name) continue;
        const qty = Number(it?.quantity ?? it?.qty ?? 1) || 1;
        tally.set(String(name), (tally.get(String(name)) ?? 0) + qty);
      }
    }
    return [...tally.entries()]
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }

  renderHtml(report: Report, sellerName?: string): string {
    const rp = (n: number) => "Rp " + n.toLocaleString("id-ID");
    const row = (cells: string[]) =>
      `<tr>${cells.map((c) => `<td style="padding:6px 10px;border-bottom:1px solid #eee">${c}</td>`).join("")}</tr>`;
    const shopTable = report.by_shop.length
      ? `<table style="border-collapse:collapse;width:100%;font-size:13px">
          ${row(["<b>Toko</b>", "<b>Order</b>", "<b>Revenue</b>"])}
          ${report.by_shop.map((s) => row([s.shop, String(s.orders), rp(s.revenue)])).join("")}
         </table>`
      : "<i>Belum ada penjualan.</i>";
    const topTable = report.top_products.length
      ? `<ul style="font-size:13px;margin:4px 0">${report.top_products.map((p) => `<li>${p.name} — ${p.qty} pcs</li>`).join("")}</ul>`
      : "<i>—</i>";

    return `<div style="font-family:Arial,sans-serif;color:#1e293b;max-width:560px">
      <h2 style="color:#2563eb;margin:0 0 4px">Laporan ${report.range.label}</h2>
      <p style="color:#64748b;margin:0 0 16px">AutoToko${sellerName ? ` — ${sellerName}` : ""}</p>
      <div style="display:flex;gap:12px;margin-bottom:16px">
        <div style="background:#f1f5f9;border-radius:8px;padding:10px 14px"><div style="font-size:11px;color:#64748b">Total Order</div><div style="font-size:20px;font-weight:700">${report.totals.orders}</div></div>
        <div style="background:#f1f5f9;border-radius:8px;padding:10px 14px"><div style="font-size:11px;color:#64748b">Revenue</div><div style="font-size:20px;font-weight:700">${rp(report.totals.revenue)}</div></div>
        <div style="background:#f1f5f9;border-radius:8px;padding:10px 14px"><div style="font-size:11px;color:#64748b">Fee Platform</div><div style="font-size:20px;font-weight:700">${rp(report.totals.platform_fee)}</div></div>
      </div>
      <h3 style="font-size:14px;margin:12px 0 4px">Performa per Toko</h3>${shopTable}
      <h3 style="font-size:14px;margin:16px 0 4px">Produk Terlaris</h3>${topTable}
      <p style="color:#94a3b8;font-size:11px;margin-top:20px">Laporan otomatis AutoToko. Atur di dashboard.</p>
    </div>`;
  }

  /** Run + email a report to every seller that has an email. Returns count sent. */
  async sendToAll(type: ReportType): Promise<number> {
    const recipients = await this.db
      .select({ id: users.id, email: users.email, name: users.fullName })
      .from(users)
      .where(isNotNull(users.email));

    let sent = 0;
    for (const u of recipients) {
      if (!u.email) continue;
      try {
        const report = await this.buildReport(u.id, type);
        // Skip empty daily reports to avoid spamming inactive sellers.
        if (type === "daily" && report.totals.orders === 0) continue;
        await this.mail.send(
          u.email,
          `[AutoToko] Laporan ${report.range.label}`,
          this.renderHtml(report, u.name ?? undefined),
        );
        sent++;
      } catch (err) {
        this.logger.warn(`Report ${type} failed for user ${u.id}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Sent ${sent} ${type} report(s).`);
    return sent;
  }
}
