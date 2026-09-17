import { Inject, Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { asc, eq, or } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { subscriptionPackages, users } from "../../database/schema/index.js";

const BASE_TIERS = ["freemium", "starter", "pro"];

export interface PackageInput {
  name?: string;
  setupFee?: string;
  monthlyFee?: string;
  perTransactionFee?: string;
  maxShops?: number | null;
  maxOrdersPerMonth?: number | null;
  features?: Record<string, boolean>;
  activityFees?: Record<string, number>;
  isActive?: boolean;
  sortOrder?: number;
}

/** CRUD paket langganan dinamis (subscription_packages). Tier bawaan tetap di pricing_config. */
@Injectable()
export class PackagesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  list() {
    return this.db.select().from(subscriptionPackages).orderBy(asc(subscriptionPackages.sortOrder));
  }

  private toSet(input: PackageInput) {
    const s: Record<string, unknown> = {};
    for (const k of [
      "name", "setupFee", "monthlyFee", "perTransactionFee", "maxShops",
      "maxOrdersPerMonth", "features", "activityFees", "isActive", "sortOrder",
    ] as const) {
      if (input[k] !== undefined) s[k] = input[k];
    }
    return s;
  }

  async create(code: string, input: PackageInput) {
    const norm = (code ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!norm) throw new BadRequestException("Kode paket tidak valid");
    if (BASE_TIERS.includes(norm)) {
      throw new BadRequestException(`"${norm}" adalah tier bawaan — atur di halaman Pricing`);
    }
    const [existing] = await this.db
      .select({ code: subscriptionPackages.code })
      .from(subscriptionPackages)
      .where(eq(subscriptionPackages.code, norm))
      .limit(1);
    if (existing) throw new BadRequestException(`Paket "${norm}" sudah ada`);
    const [row] = await this.db
      .insert(subscriptionPackages)
      .values({ code: norm, name: input.name?.trim() || norm, ...this.toSet(input) })
      .returning();
    return row;
  }

  async update(code: string, input: PackageInput) {
    const [row] = await this.db
      .update(subscriptionPackages)
      .set({ ...this.toSet(input), updatedAt: new Date() })
      .where(eq(subscriptionPackages.code, code))
      .returning();
    if (!row) throw new NotFoundException("Paket tidak ditemukan");
    return row;
  }

  async remove(code: string) {
    const [inUse] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.packageCode, code)))
      .limit(1);
    if (inUse) throw new BadRequestException("Paket masih dipakai user — pindahkan user dulu");
    await this.db.delete(subscriptionPackages).where(eq(subscriptionPackages.code, code));
    return { code, deleted: true };
  }
}
