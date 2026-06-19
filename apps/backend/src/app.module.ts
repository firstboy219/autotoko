import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { DatabaseModule } from "./database/database.module.js";
import { CryptoModule } from "./common/crypto/crypto.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { AdminSettingsModule } from "./modules/admin-settings/admin-settings.module.js";
import { ShopsModule } from "./modules/shops/shops.module.js";
import { ProductsModule } from "./modules/products/products.module.js";
import { BillingModule } from "./modules/billing/billing.module.js";
import { WebhooksModule } from "./modules/webhooks/webhooks.module.js";
import { HealthModule } from "./modules/health/health.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    CryptoModule,
    AuthModule,
    AdminSettingsModule,
    ShopsModule,
    ProductsModule,
    BillingModule,
    WebhooksModule,
    HealthModule,
  ],
})
export class AppModule {}
