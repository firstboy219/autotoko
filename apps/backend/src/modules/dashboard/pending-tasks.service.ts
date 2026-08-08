import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { resiScans, resiScanItems } from "../../database/schema/resi.js";
import { bomItems, masterProducts, materials } from "../../database/schema/products.js";
import { shops } from "../../database/schema/shops.js";

/**
 * What is not finished.
 *
 * Every one of these was already discoverable by opening the right page and
 * knowing what to look for. That is the problem: nobody opens a page to find
 * out whether there is nothing wrong, so incomplete data sat until it broke
 * something downstream — a scan with no shop is invisible to every per-shop
 * figure on the dashboard, and a material with no price silently prices the
 * products built from it at less than they cost.
 *
 * Ordered by what it costs to leave alone, not by how many there are. Ten
 * unpriced materials distort costing on every product that uses them; a
 * hundred unmapped scans distort a report nobody has run yet.
 */

export type TaskSeverity = "high" | "medium" | "low";

export interface PendingTask {
  key: string;
  title: string;
  /** What goes wrong while this is outstanding, in the seller's own terms. */
  why: string;
  count: number;
  severity: TaskSeverity;
  /** Where to go and fix it. */
  href: string;
  /** A few examples, so the card is a starting point rather than a number. */
  samples: { id: string; label: string; detail?: string }[];
}

@Injectable()
export class PendingTasksService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(userId: string): Promise<{ total: number; highCount: number; tasks: PendingTask[] }> {
    const [unmappedOrigin, unconfirmedItems, unpricedMaterials, recipelessProducts, uncategorisedShops] =
      await Promise.all([
        this.unmappedOrigin(userId),
        this.unconfirmedItems(userId),
        this.unpricedMaterials(userId),
        this.recipelessProducts(userId),
        this.uncategorisedShops(userId),
      ]);

    const tasks = [
      unpricedMaterials,
      unmappedOrigin,
      unconfirmedItems,
      recipelessProducts,
      uncategorisedShops,
    ].filter((t): t is PendingTask => t !== null);

    return {
      total: tasks.reduce((n, t) => n + t.count, 0),
      highCount: tasks.filter((t) => t.severity === "high").reduce((n, t) => n + t.count, 0),
      tasks,
    };
  }

  /** Scans nobody has said which shop they came from. */
  private async unmappedOrigin(userId: string): Promise<PendingTask | null> {
    const rows = await this.db
      .select({ id: resiScans.id, resi: resiScans.resi, sender: resiScans.labelSenderName })
      .from(resiScans)
      .where(and(eq(resiScans.userId, userId), isNull(resiScans.mappingConfirmedAt)))
      .orderBy(desc(resiScans.scannedAt))
      .limit(200);
    if (!rows.length) return null;

    return {
      key: "scan_origin",
      title: "Resi belum dipetakan ke toko",
      why:
        "Resi tanpa toko tidak masuk hitungan mana pun di dashboard — penjualan " +
        "toko itu terlihat lebih kecil dari kenyataannya.",
      count: rows.length,
      severity: "medium",
      href: "/produksi-packing?filter=belum-dipetakan",
      samples: rows.slice(0, 5).map((r) => ({
        id: r.id,
        label: r.resi,
        detail: r.sender ? `di label: ${r.sender}` : undefined,
      })),
    };
  }

  /**
   * Scans whose contents are unconfirmed, or confirmed with a line that has no
   * product. Both mean the same thing downstream: stock was not consumed.
   */
  private async unconfirmedItems(userId: string): Promise<PendingTask | null> {
    const rows = await this.db
      .select({
        id: resiScans.id,
        resi: resiScans.resi,
        items: sql<number>`(
          select count(*)::int from resi_scan_items i where i.resi_scan_id = ${resiScans.id}
        )`,
        unmapped: sql<number>`(
          select count(*)::int from resi_scan_items i
          where i.resi_scan_id = ${resiScans.id} and i.master_product_id is null
        )`,
      })
      .from(resiScans)
      .where(
        and(
          eq(resiScans.userId, userId),
          or(
            isNull(resiScans.itemsConfirmedAt),
            sql`exists (
              select 1 from resi_scan_items i
              where i.resi_scan_id = ${resiScans.id} and i.master_product_id is null
            )`,
          ),
        ),
      )
      .orderBy(desc(resiScans.scannedAt))
      .limit(200);
    if (!rows.length) return null;

    return {
      key: "scan_items",
      title: "Isi paket belum dikonfirmasi",
      why:
        "Bahan baku tidak dikurangi dari stok sampai isi paketnya dipastikan, " +
        "jadi stok di menu BOM terlihat lebih banyak dari yang sebenarnya.",
      count: rows.length,
      severity: "high",
      href: "/produksi-packing",
      samples: rows.slice(0, 5).map((r) => ({
        id: r.id,
        label: r.resi,
        detail: r.items === 0 ? "belum ada isi" : `${r.unmapped} dari ${r.items} tanpa produk`,
      })),
    };
  }

  /** Materials with no price. Everything built from them is costed short. */
  private async unpricedMaterials(userId: string): Promise<PendingTask | null> {
    const rows = await this.db
      .select({ id: materials.id, name: materials.name, unit: materials.unit })
      .from(materials)
      .where(and(eq(materials.userId, userId), lte(materials.unitCost, "0")))
      .limit(200);
    if (!rows.length) return null;

    return {
      key: "material_price",
      title: "Bahan baku belum ada harganya",
      why:
        "HPP setiap produk yang memakai bahan ini dihitung lebih murah dari " +
        "biaya sebenarnya — margin di halaman HPP jadi terlalu bagus.",
      count: rows.length,
      severity: "high",
      href: "/bom",
      samples: rows.slice(0, 5).map((r) => ({
        id: r.id,
        label: r.name,
        detail: r.unit ?? undefined,
      })),
    };
  }

  /** Products with no recipe: nothing to consume, nothing to cost. */
  private async recipelessProducts(userId: string): Promise<PendingTask | null> {
    const rows = await this.db
      .select({ id: masterProducts.id, name: masterProducts.name })
      .from(masterProducts)
      .where(
        and(
          eq(masterProducts.userId, userId),
          sql`not exists (
            select 1 from ${bomItems} b where b.master_product_id = ${masterProducts.id}
          )`,
        ),
      )
      .limit(200);
    if (!rows.length) return null;

    return {
      key: "product_recipe",
      title: "Produk belum punya resep bahan",
      why:
        "Produk tanpa resep tidak mengurangi stok apa pun saat terjual, dan " +
        "HPP-nya tidak bisa dihitung.",
      count: rows.length,
      severity: "medium",
      href: "/hpp",
      samples: rows.slice(0, 5).map((r) => ({ id: r.id, label: r.name })),
    };
  }

  /**
   * Shops with no category.
   *
   * Not cosmetic: the dashboard filters by category, and a shop without one
   * disappears from every filtered view — so its numbers are missing exactly
   * when somebody is looking at a group on purpose.
   */
  private async uncategorisedShops(userId: string): Promise<PendingTask | null> {
    const rows = await this.db
      .select({
        id: shops.id,
        name: sql<string>`coalesce(${shops.displayName}, ${shops.shopName}, '(tanpa nama)')`,
        marketplace: shops.marketplace,
      })
      .from(shops)
      .where(and(eq(shops.userId, userId), isNull(shops.categoryId)))
      .limit(200);
    if (!rows.length) return null;

    return {
      key: "shop_category",
      title: "Toko belum masuk kategori",
      why:
        "Toko tanpa kategori tidak muncul saat dashboard difilter per kategori, " +
        "jadi angkanya hilang justru ketika sedang dilihat per kelompok.",
      count: rows.length,
      severity: "low",
      href: "/toko",
      samples: rows.slice(0, 5).map((r) => ({
        id: r.id,
        label: r.name,
        detail: r.marketplace ?? undefined,
      })),
    };
  }
}
