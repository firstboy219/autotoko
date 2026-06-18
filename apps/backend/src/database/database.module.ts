import { Global, Module, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export const DRIZZLE = Symbol("DRIZZLE");
export type Database = PostgresJsDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
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
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
