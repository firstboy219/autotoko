import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsInt, IsOptional, IsISO8601, IsUUID, Min } from "class-validator";
import { Type } from "class-transformer";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import {
  OrdersService,
  FULFILLMENT_STATUSES,
  type FulfillmentStatus,
} from "./orders.service.js";
import { OrderSyncService } from "./order-sync.service.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Normally the caller; an admin may act on behalf of a seller via ?userId=.
function targetUser(req: FastifyRequest, override?: string): string {
  const caller = (req as FastifyRequest & { user: JwtPayload }).user;
  if (!override) return caller.sub;
  if (caller.role !== "admin") {
    throw new ForbiddenException("Only admins may act on behalf of another user");
  }
  if (!UUID_RE.test(override)) throw new BadRequestException("Invalid userId");
  return override;
}

class UpdateStatusDto {
  @IsIn(FULFILLMENT_STATUSES as unknown as string[])
  status!: FulfillmentStatus;
}

class ListOrdersQuery {
  @IsOptional() @IsIn(FULFILLMENT_STATUSES as unknown as string[])
  status?: FulfillmentStatus;

  @IsOptional() @IsUUID()
  shopId?: string;

  @IsOptional() @IsISO8601()
  dateFrom?: string;

  @IsOptional() @IsISO8601()
  dateTo?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

@Controller("orders")
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly sync: OrderSyncService,
  ) {}

  // --- API order sync (audit) ---------------------------------------------
  // Pull a connected shop's orders from the marketplace API into
  // order_api_snapshots (separate from local `orders`, which is never touched).
  @Post("sync/:shopId")
  async syncOrders(
    @Req() req: FastifyRequest,
    @Param("shopId") shopId: string,
    @Query("userId") userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.syncOrders(targetUser(req, userId), shopId) };
  }

  // Audit view of the API-pulled order snapshots for a shop.
  @Get("api-snapshots/:shopId")
  async apiSnapshots(
    @Req() req: FastifyRequest,
    @Param("shopId") shopId: string,
    @Query("userId") userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.sync.listSnapshots(targetUser(req, userId), shopId),
    };
  }

  @Get()
  async list(
    @Req() req: FastifyRequest,
    @Query() q: ListOrdersQuery,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.orders.list(uid(req), {
        status: q.status,
        shopId: q.shopId,
        dateFrom: q.dateFrom ? new Date(q.dateFrom) : undefined,
        dateTo: q.dateTo ? new Date(q.dateTo) : undefined,
        limit: q.limit,
        offset: q.offset,
      }),
    };
  }

  @Get("summary")
  async summary(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.orders.summary(uid(req)) };
  }

  @Get(":id")
  async get(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.orders.get(uid(req), id) };
  }

  @Patch(":id/status")
  async updateStatus(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: UpdateStatusDto,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.orders.updateStatus(uid(req), id, dto.status),
    };
  }
}
