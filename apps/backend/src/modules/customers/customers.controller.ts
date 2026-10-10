import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { CustomersService } from "./customers.service.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}
const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

@Controller("customers")
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  async list(
    @Req() req: FastifyRequest,
    @Query("q") q?: string,
    @Query("repeat") repeat?: string,
    @Query("sort") sort?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<ApiResponse<unknown>> {
    return ok(
      await this.customers.list(uid(req), {
        q,
        repeatOnly: repeat === "1" || repeat === "true",
        sort,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      }),
    );
  }

  @Get(":key")
  async detail(@Req() req: FastifyRequest, @Param("key") key: string): Promise<ApiResponse<unknown>> {
    return ok(await this.customers.detail(uid(req), key));
  }
}
