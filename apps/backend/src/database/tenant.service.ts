import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { sql } from "drizzle-orm";
import { DRIZZLE_BASE, type Database } from "./database.tokens.js";
import { tenantStore } from "./tenant-context.js";

/**
 * Runs work inside a tenant-scoped transaction for Postgres RLS. No-op unless
 * RLS_ENABLED=true, so toggling the flag (off by default) fully reverts to the
 * previous app-layer-only isolation without code changes.
 *
 *  - runAsUser(id, fn): SET LOCAL app.user_id → policies allow only that user's rows.
 *  - runBypass(fn): SET LOCAL app.bypass=on → see all rows (cron jobs, webhooks,
 *    unauthenticated/admin paths that legitimately cross the tenant boundary).
 */
@Injectable()
export class TenantService {
  private readonly rls: boolean;

  constructor(
    @Inject(DRIZZLE_BASE) private readonly base: Database,
    config: ConfigService,
  ) {
    this.rls = config.get<string>("RLS_ENABLED") === "true";
  }

  get enabled(): boolean {
    return this.rls;
  }

  async runAsUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    if (!this.rls) return fn();
    return this.base.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
      return tenantStore.run({ db: tx as unknown as Database }, fn);
    });
  }

  async runBypass<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.rls) return fn();
    return this.base.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.bypass', 'on', true)`);
      return tenantStore.run({ db: tx as unknown as Database }, fn);
    });
  }
}
