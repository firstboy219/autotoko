import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR, APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { DatabaseModule } from "./database/database.module.js";
import { TenantInterceptor } from "./common/tenant/tenant.interceptor.js";
import { CryptoModule } from "./common/crypto/crypto.module.js";
import { MailModule } from "./common/mail/mail.module.js";
import { EventsModule } from "./modules/events/events.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { AdminSettingsModule } from "./modules/admin-settings/admin-settings.module.js";
import { ShopsModule } from "./modules/shops/shops.module.js";
import { ProductsModule } from "./modules/products/products.module.js";
import { BillingModule } from "./modules/billing/billing.module.js";
import { WebhooksModule } from "./modules/webhooks/webhooks.module.js";
import { OrdersModule } from "./modules/orders/orders.module.js";
import { BomModule } from "./modules/bom/bom.module.js";
import { AiModule } from "./modules/ai/ai.module.js";
import { ReportsModule } from "./modules/reports/reports.module.js";
import { CatalogModule } from "./modules/catalog/catalog.module.js";
import { MarketingModule } from "./modules/marketing/marketing.module.js";
import { AccountModule } from "./modules/account/account.module.js";
import { BrandingModule } from "./modules/branding/branding.module.js";
import { DashboardModule } from "./modules/dashboard/dashboard.module.js";
import { HealthModule } from "./modules/health/health.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
    ScheduleModule.forRoot(),
    // Global rate limit (per client IP via trustProxy). Generous so a normal
    // multi-tab SPA never trips it; auth endpoints add a tighter @Throttle to
    // protect against login/OTP brute force.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    DatabaseModule,
    CryptoModule,
    MailModule,
    EventsModule,
    AuthModule,
    AdminSettingsModule,
    ShopsModule,
    ProductsModule,
    BillingModule,
    WebhooksModule,
    OrdersModule,
    BomModule,
    AiModule,
    ReportsModule,
    CatalogModule,
    MarketingModule,
    AccountModule,
    BrandingModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [
    // Global RLS request-context wrapper (no-op unless RLS_ENABLED=true).
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    // Global rate limiter.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
