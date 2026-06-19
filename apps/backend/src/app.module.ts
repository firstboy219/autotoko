import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "./database/database.module.js";
import { CryptoModule } from "./common/crypto/crypto.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { AdminSettingsModule } from "./modules/admin-settings/admin-settings.module.js";
import { HealthModule } from "./modules/health/health.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
    DatabaseModule,
    CryptoModule,
    AuthModule,
    AdminSettingsModule,
    HealthModule,
  ],
})
export class AppModule {}
