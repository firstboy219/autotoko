import { AsyncLocalStorage } from "node:async_hooks";
import type { Database } from "./database.tokens.js";

/**
 * Per-request tenant context for Postgres RLS. When set, it carries the
 * transaction-bound db whose session has `app.user_id` (or `app.bypass`) set, so
 * RLS policies apply. The DRIZZLE provider is a Proxy that routes to this db when
 * a context is active, otherwise to the base pool — so existing `this.db.*` calls
 * need no changes.
 */
export const tenantStore = new AsyncLocalStorage<{ db: Database }>();
