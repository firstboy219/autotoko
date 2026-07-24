import {
  Body,
  Controller,
  Delete,
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
import { PayoutSellersService } from "./sellers.service.js";
import { PayoutBatchService } from "./batch.service.js";
import { PayoutMutationService } from "./mutation.service.js";
import {
  CreateSubSellerDto,
  UpdateSubSellerDto,
  CreateSubSubSellerDto,
  UpdateSubSubSellerDto,
  AssignShopDto,
  UpdatePayoutSettingsDto,
  MarkBatchTransferredDto,
  CreateMutationDto,
  UpdateMutationDto,
  CompleteMutationDto,
  ListMutationQueryDto,
  CreateAdjustmentDto,
} from "./dto.js";

function uid(req: FastifyRequest): string {
  return (req as FastifyRequest & { user: JwtPayload }).user.sub;
}

const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

@Controller("payout")
@UseGuards(JwtAuthGuard)
export class PayoutController {
  constructor(
    private readonly sellers: PayoutSellersService,
    private readonly batches: PayoutBatchService,
    private readonly mutations: PayoutMutationService,
  ) {}

  // --- Sub-sellers ---
  @Get("sub-sellers")
  async listSubSellers(@Req() req: FastifyRequest) {
    return ok(await this.sellers.listSubSellers(uid(req)));
  }

  @Post("sub-sellers")
  async createSubSeller(@Req() req: FastifyRequest, @Body() dto: CreateSubSellerDto) {
    return ok(await this.sellers.createSubSeller(uid(req), dto));
  }

  @Patch("sub-sellers/:id")
  async updateSubSeller(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: UpdateSubSellerDto,
  ) {
    return ok(await this.sellers.updateSubSeller(uid(req), id, dto));
  }

  // --- Sub-sub-sellers ---
  @Get("sub-sub-sellers")
  async listSubSubSellers(
    @Req() req: FastifyRequest,
    @Query("subSellerId") subSellerId?: string,
  ) {
    return ok(await this.sellers.listSubSubSellers(uid(req), subSellerId));
  }

  @Post("sub-sub-sellers")
  async createSubSubSeller(@Req() req: FastifyRequest, @Body() dto: CreateSubSubSellerDto) {
    return ok(await this.sellers.createSubSubSeller(uid(req), dto));
  }

  @Patch("sub-sub-sellers/:id")
  async updateSubSubSeller(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: UpdateSubSubSellerDto,
  ) {
    return ok(await this.sellers.updateSubSubSeller(uid(req), id, dto));
  }

  // --- Shops (with resolved payout rates, for the mutation form) ---
  @Get("shops")
  async listShops(@Req() req: FastifyRequest) {
    return ok(await this.sellers.listShopsForPayout(uid(req)));
  }

  // --- Shop assignment ---
  @Post("shops/:shopId/assign")
  async assignShop(
    @Req() req: FastifyRequest,
    @Param("shopId") shopId: string,
    @Body() dto: AssignShopDto,
  ) {
    return ok(await this.sellers.assignShop(uid(req), shopId, dto));
  }

  // --- Settings ---
  @Get("settings")
  async getSettings(@Req() req: FastifyRequest) {
    return ok(await this.sellers.getSettings(uid(req)));
  }

  @Patch("settings")
  async updateSettings(@Req() req: FastifyRequest, @Body() dto: UpdatePayoutSettingsDto) {
    return ok(await this.sellers.updateSettings(uid(req), dto));
  }

  // --- Batches ---
  @Get("batches")
  async listBatches(@Req() req: FastifyRequest, @Query("status") status?: string) {
    return ok(await this.batches.list(uid(req), status));
  }

  @Get("batches/:id")
  async getBatch(@Req() req: FastifyRequest, @Param("id") id: string) {
    return ok(await this.batches.get(uid(req), id));
  }

  @Post("batches")
  async startBatch(@Req() req: FastifyRequest) {
    return ok(await this.batches.start(uid(req), uid(req)));
  }

  @Post("batches/:id/close")
  async closeBatch(@Req() req: FastifyRequest, @Param("id") id: string) {
    return ok(await this.batches.closeAndReport(uid(req), id));
  }

  @Post("batches/:id/transferred")
  async markBatchTransferred(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: MarkBatchTransferredDto,
  ) {
    return ok(await this.batches.markTransferred(uid(req), id, dto));
  }

  // --- Mutations ---
  @Get("mutations")
  async listMutations(@Req() req: FastifyRequest, @Query() q: ListMutationQueryDto) {
    return ok(await this.mutations.list(uid(req), q));
  }

  @Post("mutations")
  async createMutation(@Req() req: FastifyRequest, @Body() dto: CreateMutationDto) {
    return ok(await this.mutations.create(uid(req), uid(req), dto));
  }

  @Patch("mutations/:id")
  async updateMutation(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: UpdateMutationDto,
  ) {
    return ok(await this.mutations.update(uid(req), id, dto));
  }

  @Delete("mutations/:id")
  async deleteMutation(@Req() req: FastifyRequest, @Param("id") id: string) {
    return ok(await this.mutations.remove(uid(req), id));
  }

  @Post("mutations/:id/complete")
  async completeMutation(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: CompleteMutationDto,
  ) {
    return ok(await this.mutations.complete(uid(req), id, dto));
  }

  @Post("mutations/:id/forward")
  async forwardMutation(@Req() req: FastifyRequest, @Param("id") id: string) {
    return ok(await this.mutations.markForwarded(uid(req), id));
  }

  @Get("mutations/:id/adjustments")
  async listAdjustments(@Req() req: FastifyRequest, @Param("id") id: string) {
    return ok(await this.mutations.listAdjustments(uid(req), id));
  }

  // --- Adjustments ---
  @Post("adjustments")
  async createAdjustment(@Req() req: FastifyRequest, @Body() dto: CreateAdjustmentDto) {
    return ok(await this.mutations.createAdjustment(uid(req), uid(req), dto));
  }
}
