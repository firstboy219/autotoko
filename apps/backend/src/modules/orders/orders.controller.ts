import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsISO8601, IsString, IsUUID, Min } from "class-validator";
import { Type } from "class-transformer";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import {
  OrdersService,
  FULFILLMENT_STATUSES,
  type FulfillmentStatus,
} from "./orders.service.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

class UpdateStatusDto {
  @IsIn(FULFILLMENT_STATUSES as unknown as string[])
  status!: FulfillmentStatus;
}

class BulkStatusDto {
  @IsArray() @IsUUID("4", { each: true })
  ids!: string[];

  @IsIn(FULFILLMENT_STATUSES as unknown as string[])
  status!: FulfillmentStatus;
}

class OrderSettingsDto {
  @IsOptional() @IsBoolean()
  autoSiapKirim?: boolean;

  @IsOptional() @IsArray() @IsString({ each: true })
  instantCouriers?: string[];
}

class ListOrdersQuery {
  @IsOptional() @IsIn(FULFILLMENT_STATUSES as unknown as string[])
  status?: FulfillmentStatus;

  @IsOptional() @IsIn(["0", "1", "true", "false"])
  active?: string;

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
  constructor(private readonly orders: OrdersService) {}

  @Get()
  async list(
    @Req() req: FastifyRequest,
    @Query() q: ListOrdersQuery,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.orders.list(uid(req), {
        status: q.status,
        active: q.active === "1" || q.active === "true",
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

  @Get("board-summary")
  async boardSummary(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.orders.boardSummary(uid(req)) };
  }

  @Get("health")
  async health(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.orders.health(uid(req)) };
  }

  @Get("status-meta")
  statusMeta(): ApiResponse<unknown> {
    return { success: true, data: this.orders.statusMeta() };
  }

  @Get("settings")
  async getSettings(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.orders.getOrderSettings(uid(req)) };
  }

  @Patch("settings")
  async updateSettings(
    @Req() req: FastifyRequest,
    @Body() dto: OrderSettingsDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.orders.updateOrderSettings(uid(req), dto) };
  }

  @Patch("status/bulk")
  async updateStatusBulk(
    @Req() req: FastifyRequest,
    @Body() dto: BulkStatusDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.orders.updateStatusBulk(uid(req), dto.ids, dto.status) };
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

  @Post(":id/awb")
  async generateAwb(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.orders.generateAwb(uid(req), id) };
  }
}
