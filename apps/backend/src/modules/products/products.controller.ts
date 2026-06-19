import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { ProductsService } from "./products.service.js";
import {
  CreateMasterDto,
  UpdateMasterDto,
  CreatePostingDto,
} from "./dto/products.dto.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

@Controller("products")
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  async list(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.listMasters(uid(req)) };
  }

  @Post()
  async create(
    @Req() req: FastifyRequest,
    @Body() dto: CreateMasterDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.createMaster(uid(req), dto) };
  }

  @Get(":id")
  async detail(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.getMaster(uid(req), id) };
  }

  @Patch(":id")
  async update(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: UpdateMasterDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.updateMaster(uid(req), id, dto) };
  }

  @Delete(":id")
  async remove(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.deleteMaster(uid(req), id) };
  }

  @Post(":id/postings")
  async addPosting(
    @Req() req: FastifyRequest,
    @Body() dto: CreatePostingDto,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.createPosting(uid(req), dto) };
  }

  @Delete("postings/:postingId")
  async removePosting(
    @Req() req: FastifyRequest,
    @Param("postingId") postingId: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.deletePosting(uid(req), postingId) };
  }
}
