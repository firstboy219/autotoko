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
import { DisbursementsService } from "./disbursements.service.js";
import { OcrService } from "./ocr.service.js";
import {
  CreateSubSellerDto,
  UpdateSubSellerDto,
  CreateSubSubSellerDto,
  UpdateSubSubSellerDto,
  AssignShopDto,
  UpdatePayoutSettingsDto,
  CreateMutationDto,
  UpdateMutationDto,
  ListMutationQueryDto,
  CreateAdjustmentDto,
  UploadDisbursementProofDto,
  OverrideDisbursementDto,
  OcrExtractDto,
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
    private readonly disbursements: DisbursementsService,
    private readonly ocr: OcrService,
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

  // --- Shops (with resolved payout rates, for the mutation form + mapping page) ---
  @Get("shops")
  async listShops(@Req() req: FastifyRequest) {
    return ok(await this.sellers.listShopsForPayout(uid(req)));
  }

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

  // --- OCR (Titik 1): extract-only preview called right after uploading a
  // pencairan screenshot, BEFORE the mutation form is submitted, so staff can
  // review/correct the suggested nominal + rekening (Bagian 1, Tahap 1).
  @Post("ocr/extract-pencairan")
  async extractPencairanProof(@Body() dto: OcrExtractDto) {
    return ok(await this.ocr.extractProofFields(dto.imageUrl));
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

  /** Tahap 2 — "Selesai Pencairan Semua Toko": locks input, generates the disbursement rekap. */
  @Post("batches/:id/close-input")
  async closeInput(@Req() req: FastifyRequest, @Param("id") id: string) {
    return ok(await this.batches.closeInput(uid(req), id));
  }

  /** Tahap 4 — "Tutup Batch": only once every disbursement is validated/overridden. */
  @Post("batches/:id/close")
  async closeBatch(@Req() req: FastifyRequest, @Param("id") id: string) {
    return ok(await this.batches.closeBatch(uid(req), id));
  }

  // --- Mutations (Tahap 1) ---
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

  @Get("mutations/:id/adjustments")
  async listAdjustments(@Req() req: FastifyRequest, @Param("id") id: string) {
    return ok(await this.mutations.listAdjustments(uid(req), id));
  }

  // --- Adjustments ---
  @Post("adjustments")
  async createAdjustment(@Req() req: FastifyRequest, @Body() dto: CreateAdjustmentDto) {
    return ok(await this.mutations.createAdjustment(uid(req), uid(req), dto));
  }

  // --- Disbursements (Tahap 3 — per-recipient transfer, Titik 2 OCR happens inside uploadProof) ---
  @Post("disbursements/:id/proof")
  async uploadDisbursementProof(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: UploadDisbursementProofDto,
  ) {
    return ok(await this.disbursements.uploadProof(uid(req), id, dto));
  }

  @Post("disbursements/:id/override")
  async overrideDisbursement(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Body() dto: OverrideDisbursementDto,
  ) {
    return ok(await this.disbursements.override(uid(req), id, dto));
  }
}
