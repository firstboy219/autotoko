import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import { IsIn } from "class-validator";
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

@Controller("orders")
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  async list(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.orders.list(uid(req)) };
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
