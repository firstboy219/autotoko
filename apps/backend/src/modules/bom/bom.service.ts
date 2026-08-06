import { Inject, Injectable, BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  bomItems,
  masterProducts,
  materials,
  productPostings,
  users,
} from "../../database/schema/index.js";
import { CryptoService } from "../../common/crypto/crypto.service.js";
import { MailService } from "../../common/mail/mail.service.js";
import type { CreateBomDto, UpdateBomDto } from "./dto/bom.dto.js";

type BomRow = typeof bomItems.$inferSelect;

/** Strip the encrypted supplier API key from API output. */
function publicBom(row: BomRow & { masterName?: string | null; masterSku?: string | null }) {
  const { supplierApiKey, ...rest } = row;
  return {
    ...rest,
    hasApiKey: Boolean(supplierApiKey),
    lowStock: Number(row.currentStock) <= Number(row.minimumThreshold),
  };
}

@Injectable()
export class BomService {
  private readonly logger = new Logger(BomService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
  ) {}

  /** All materials whose master product belongs to the user (multi-tenant). */
  async list(userId: string, onlyLow = false) {
    const rows = await this.db
      .select({
        bom: bomItems,
        masterName: masterProducts.name,
        masterSku: masterProducts.sku,
      })
      .from(bomItems)
      .innerJoin(masterProducts, eq(bomItems.masterProductId, masterProducts.id))
      .where(eq(masterProducts.userId, userId));

    const mapped = rows
      .map((r) => publicBom({ ...r.bom, masterName: r.masterName, masterSku: r.masterSku }))
      .filter((b) => (onlyLow ? b.lowStock : true));
    return mapped;
  }

  alerts(userId: string) {
    return this.list(userId, true);
  }

  /**
   * The catalogue id for a material name, creating the entry if it is new.
   *
   * Matching is on the normalised name, the same key the catalogue's unique
   * index uses, so "Botol" and "botol " land on one material rather than two
   * with separate stock and separate prices.
   */
  private async linkToCatalog(
    userId: string,
    name: string,
    unit?: string | null,
    unitCost?: string | number | null,
  ): Promise<string> {
    const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
    const [found] = await this.db
      .select({ id: materials.id })
      .from(materials)
      .where(and(eq(materials.userId, userId), eq(materials.normalizedName, normalized)))
      .limit(1);
    if (found) return found.id;

    const [made] = await this.db
      .insert(materials)
      .values({
        userId,
        name: name.trim(),
        normalizedName: normalized,
        unit: unit?.trim() || null,
        unitCost: unitCost != null ? Number(unitCost).toFixed(2) : "0",
        unitCostUpdatedAt: unitCost != null ? new Date() : null,
      })
      .returning({ id: materials.id });
    return made!.id;
  }

  private async requireMasterOwned(userId: string, masterProductId: string) {
    const [m] = await this.db
      .select({ id: masterProducts.id })
      .from(masterProducts)
      .where(and(eq(masterProducts.id, masterProductId), eq(masterProducts.userId, userId)))
      .limit(1);
    if (!m) throw new BadRequestException("Master product not found for this user");
  }

  /** Load a bom row + assert its master belongs to the user. */
  private async requireBomOwned(userId: string, id: string): Promise<BomRow> {
    const [row] = await this.db
      .select({ bom: bomItems })
      .from(bomItems)
      .innerJoin(masterProducts, eq(bomItems.masterProductId, masterProducts.id))
      .where(and(eq(bomItems.id, id), eq(masterProducts.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException("BOM item not found");
    return row.bom;
  }

  async create(userId: string, dto: CreateBomDto) {
    await this.requireMasterOwned(userId, dto.masterProductId);
    // Join the catalogue on the way in. This endpoint used to insert a name and
    // a price straight onto the line, which is how 8 of 39 lines ended up
    // costing from a private copy that a catalogue price change could not
    // reach. Its form is gone from the page, but the route is still callable.
    const materialId = await this.linkToCatalog(userId, dto.materialName, dto.unit);
    const values = {
      ...dto,
      materialId,
      supplierApiKey: dto.supplierApiKey ? this.crypto.encrypt(dto.supplierApiKey) : undefined,
    };
    const [row] = await this.db.insert(bomItems).values(values).returning();
    return publicBom(row!);
  }

  async update(userId: string, id: string, dto: UpdateBomDto) {
    await this.requireBomOwned(userId, id);
    const patch: Record<string, unknown> = { ...dto };
    if (dto.supplierApiKey) patch.supplierApiKey = this.crypto.encrypt(dto.supplierApiKey);
    const [row] = await this.db
      .update(bomItems)
      .set(patch)
      .where(eq(bomItems.id, id))
      .returning();
    return publicBom(row!);
  }

  async remove(userId: string, id: string) {
    await this.requireBomOwned(userId, id);
    await this.db.delete(bomItems).where(eq(bomItems.id, id));
    return { deleted: id };
  }

  /** Manual restock: add `amount` (or the configured restockQty) to current stock. */
  async restock(userId: string, id: string, amount?: string) {
    const cur = await this.requireBomOwned(userId, id);
    const add = Number(amount ?? cur.restockQty ?? 0);
    const next = (Number(cur.currentStock) + add).toFixed(3);
    const [row] = await this.db
      .update(bomItems)
      .set({ currentStock: next })
      .where(eq(bomItems.id, id))
      .returning();
    return publicBom(row!);
  }

  /**
   * Auto-deduct raw materials when a new order is created (PRD Bagian 15 — BOM).
   * Resolves each order line's marketplace SKU → product_postings → master
   * product → bom_items, then subtracts qty_sold × quantity_per_product.
   * Sends a low-stock email alert when a material drops below its threshold.
   * Skips silently when no BOM/posting is mapped (never blocks the order).
   */
  async deductForOrder(order: {
    id: string;
    userId: string;
    items: unknown;
  }): Promise<{ deducted: number }> {
    const lines = this.parseLines(order.items);
    if (lines.length === 0) return { deducted: 0 };

    let deducted = 0;
    for (const line of lines) {
      const masterId = await this.resolveMaster(order.userId, line.sku);
      if (!masterId) continue;

      const boms = await this.db
        .select()
        .from(bomItems)
        .where(eq(bomItems.masterProductId, masterId));

      for (const bom of boms) {
        const used = line.qty * Number(bom.quantity);
        const next = Number(bom.currentStock) - used;
        await this.db
          .update(bomItems)
          .set({ currentStock: next.toFixed(3) })
          .where(eq(bomItems.id, bom.id));
        deducted++;
        this.logger.log(
          `BOM deduct: ${bom.materialName} -${used} → ${next} (order ${order.id})`,
        );
        if (next < Number(bom.minimumThreshold)) {
          await this.sendLowStockAlert(order.userId, bom.materialName, next, Number(bom.minimumThreshold), bom.unit);
        }
      }
    }
    return { deducted };
  }

  private parseLines(items: unknown): { sku: string; qty: number }[] {
    if (!Array.isArray(items)) return [];
    const out: { sku: string; qty: number }[] = [];
    for (const it of items as Record<string, unknown>[]) {
      const sku = String(
        it?.seller_sku ?? it?.sellerSku ?? it?.sku ?? it?.sku_id ?? it?.skuId ?? "",
      );
      const qty = Number(it?.quantity ?? it?.sku_count ?? it?.qty ?? 1) || 0;
      if (sku && qty > 0) out.push({ sku, qty });
    }
    return out;
  }

  /** marketplace SKU → master product id (only if the master belongs to user). */
  private async resolveMaster(userId: string, sku: string): Promise<string | null> {
    const [row] = await this.db
      .select({ masterId: productPostings.masterProductId })
      .from(productPostings)
      .innerJoin(masterProducts, eq(productPostings.masterProductId, masterProducts.id))
      .where(and(eq(productPostings.marketplaceSku, sku), eq(masterProducts.userId, userId)))
      .limit(1);
    return row?.masterId ?? null;
  }

  private async sendLowStockAlert(
    userId: string,
    material: string,
    remaining: number,
    minimum: number,
    unit: string | null,
  ) {
    const [user] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const u = unit ?? "";
    this.logger.warn(`Low stock: ${material} ${remaining}${u} < min ${minimum}${u} (user ${userId})`);
    if (!user?.email) return;
    await this.mail
      .send(
        user.email,
        `⚠️ Stok Bahan Baku Hampir Habis — ${material}`,
        `<p>Stok bahan <b>${material}</b> tinggal <b>${remaining} ${u}</b> (minimum ${minimum} ${u}).</p>
         <p>Segera restock agar produksi tidak terganggu.</p>`,
        `Stok ${material} tinggal ${remaining}${u} (min ${minimum}${u}).`,
      )
      .catch((e) => this.logger.warn(`Low-stock email failed: ${(e as Error).message}`));
  }
}
