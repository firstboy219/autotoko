import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { ProductsService } from "./products.service.js";
import { ProductSyncService } from "./product-sync.service.js";
import {
  CreateMasterDto,
  UpdateMasterDto,
  CreatePostingDto,
  MergePostingDto,
} from "./dto/products.dto.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolve the target user: normally the caller, but an admin may act on behalf
// of a specific seller via ?userId= (mirrors ShopsController.connect).
function targetUser(req: FastifyRequest, override?: string): string {
  const caller = (req as FastifyRequest & { user: JwtPayload }).user;
  if (!override) return caller.sub;
  if (caller.role !== "admin") {
    throw new ForbiddenException("Only admins may act on behalf of another user");
  }
  if (!UUID_RE.test(override)) throw new BadRequestException("Invalid userId");
  return override;
}

@Controller("products")
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly sync: ProductSyncService,
  ) {}

  @Get()
  async list(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.products.listMasters(uid(req)) };
  }

  // --- API product sync (audit) -------------------------------------------
  // Pull a connected shop's catalog from the marketplace API into product_postings
  // as source="api" rows. Manual (audit) rows are never overwritten.
  @Post("sync/:shopId")
  async syncProducts(
    @Req() req: FastifyRequest,
    @Param("shopId") shopId: string,
    @Query("userId") userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.sync.syncProducts(targetUser(req, userId), shopId),
    };
  }

  // Review queue: API postings not yet linked to a master product.
  @Get("postings/pending")
  async pendingPostings(
    @Req() req: FastifyRequest,
    @Query("userId") userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return { success: true, data: await this.sync.listPending(targetUser(req, userId)) };
  }

  // Merge an API posting onto a master (existing or newly created from it).
  @Post("postings/:postingId/merge")
  async mergePosting(
    @Req() req: FastifyRequest,
    @Param("postingId") postingId: string,
    @Body() dto: MergePostingDto,
  ): Promise<ApiResponse<unknown>> {
    return {
      success: true,
      data: await this.sync.merge(uid(req), postingId, {
        masterProductId: dto.masterProductId,
        createMaster: dto.createMaster,
      }),
    };
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
