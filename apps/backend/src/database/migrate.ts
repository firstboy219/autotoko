import { existsSync, readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Minimal .env loader — the prod deploy bundle (pnpm deploy --prod) does NOT
 * include `dotenv` (it's a devDependency; the app uses @nestjs/config at
 * runtime). Depending on `dotenv/config` here made deploy migrations crash with
 * MODULE_NOT_FOUND (relay sesi 16). Read .env ourselves with zero deps.
 */
function loadEnv(): void {
  if (process.env.DATABASE_URL) return;
  const path = process.env.ENV_FILE ?? "./.env";
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!.trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

// Standalone migration runner — used in deploy/CI:
//   node dist/database/migrate.js   (run from the app root so ./drizzle resolves)
async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  // Dedicated single connection for migrations (max: 1).
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  console.log("Running migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");

  await client.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
