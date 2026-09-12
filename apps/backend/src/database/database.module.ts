import { Global, Module, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { tenantStore } from "./tenant-context.js";
import { TenantService } from "./tenant.service.js";
import { DRIZZLE, DRIZZLE_BASE, type Database } from "./database.tokens.js";

// Re-export so existing imports of DRIZZLE/Database from this module keep working.
export { DRIZZLE, DRIZZLE_BASE, type Database } from "./database.tokens.js";

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE_BASE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Database => {
        const url = config.get<string>("DATABASE_URL");
        if (!url) {
          throw new Error("DATABASE_URL is not set");
        }
        // postgres.js — lean driver; small pool to respect the shared host's RAM.
        const client = postgres(url, { max: 10 });
        Logger.log("Drizzle (postgres-js) connection initialized", "Database");
        return drizzle(client, { schema });
      },
    },
    {
      // What everything injects. When RLS is enabled, transparently route each
      // call to the active tenant-scoped transaction (set by TenantService); else
      // straight to the base pool. When RLS is off, this IS the base pool, so the
      // whole RLS layer is a no-op until the flag flips.
      provide: DRIZZLE,
      inject: [DRIZZLE_BASE, ConfigService],
      useFactory: (base: Database, config: ConfigService): Database => {
        if (config.get<string>("RLS_ENABLED") !== "true") return base;
        return new Proxy(base, {
          get(target, prop) {
            const active = (tenantStore.getStore()?.db ?? target) as unknown as Record<
              string | symbol,
              unknown
            >;
            const value = active[prop];
            return typeof value === "function"
              ? (value as (...a: unknown[]) => unknown).bind(active)
              : value;
          },
        }) as Database;
      },
    },
    TenantService,
  ],
  exports: [DRIZZLE, DRIZZLE_BASE, TenantService],
})
export class DatabaseModule {}
