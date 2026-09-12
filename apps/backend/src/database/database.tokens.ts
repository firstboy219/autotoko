import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema";

// DI tokens + db type live here (not in database.module) so TenantService and the
// module can both import them without a circular dependency.
export const DRIZZLE = Symbol("DRIZZLE");
/** The raw pool db (no RLS proxy) — used by TenantService to open scoped txns. */
export const DRIZZLE_BASE = Symbol("DRIZZLE_BASE");
export type Database = PostgresJsDatabase<typeof schema>;
