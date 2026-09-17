import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, AdminOnly } from "../auth/jwt-auth.guard.js";
import { WalletService } from "./wallet.service.js";

const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

/** Admin-only billing views: platform invoices (top-up/subscription). */
@Controller("admin/billing")
@UseGuards(JwtAuthGuard)
@AdminOnly()
export class AdminBillingController {
  constructor(private readonly wallet: WalletService) {}

  @Get("invoices")
  async invoices(
    @Query("userId") userId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return ok(
      await this.wallet.listInvoices({
        userId: userId || undefined,
        status: status || undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    );
  }
}
