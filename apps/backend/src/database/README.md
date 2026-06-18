# Database layer (Drizzle + PostgreSQL)

Schema mirrors **PRD Bagian 9**. Driver: `postgres-js` (lean, good for the
shared 3.7 GB host). On the server AutoToko **reuses the shared postgres
container** with its own database `autotoko` (isolated from xtracker `saasdb`
and `geoscan`).

## Commands (run in `apps/backend`)

```bash
pnpm db:generate   # generate SQL migration from schema changes
pnpm db:migrate    # apply migrations (drizzle-kit, needs DATABASE_URL)
pnpm db:push       # push schema directly (dev only)
pnpm db:studio     # drizzle studio
```

Deploy applies migrations via the standalone runner: `node dist/database/migrate.js`.
Generated migrations live in `apps/backend/drizzle/` and **are committed**.

## Multi-tenant isolation (PRD Bagian 17.5)

Every tenant-scoped table carries `user_id`. **All queries MUST filter by
`user_id`** in the app layer — this is the primary isolation mechanism.

As defense-in-depth, PRD calls for PostgreSQL **Row-Level Security (RLS)**.
That is a planned follow-up: a hand-written SQL migration will
`ENABLE ROW LEVEL SECURITY` on tenant tables with a policy keyed off a
`current_setting('app.user_id')` GUC set per request/transaction. Not enabled
yet — tracked as a TODO before multi-tenant data goes live.

## Provisioning the server DB (when approved)

```sql
-- as postgres superuser (admin) inside the shared container:
CREATE ROLE autotoko_user LOGIN PASSWORD '<secret>';
CREATE DATABASE autotoko OWNER autotoko_user;
```
Then set `DATABASE_URL` and run the migration. This touches the shared host, so
it needs explicit go-ahead (it was intentionally not auto-run during scaffold).
