import {
  IsBoolean,
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  IsUUID,
  IsArray,
  IsDateString,
  IsInt,
  MaxLength,
  Min,
  Max,
} from "class-validator";

/**
 * DTOs for the Payout module (FLOW_PENCAIRAN_V2_FINAL.md). Rates are fractions
 * in [0,1] (0.20 = 20%) end to end — API, calc, and DB share one unit. Money
 * fields are rupiah numbers; the service converts to integer cents for the split.
 */

const SEDEKAH_BASES = ["total_credit", "after_subseller_split", "both_from_total"] as const;

// --- Sub-seller / Sub-sub-seller ---

export class CreateSubSellerDto {
  @IsString() @MaxLength(255) name!: string;
  @IsOptional() @IsString() @MaxLength(64) contact?: string;
  @IsOptional() @IsString() @MaxLength(255) loginEmail?: string;
  @IsOptional() @IsString() @MaxLength(255) bankAccount?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) defaultRate?: number;
  // Null/omitted = unlimited (MAPPING_DAN_SELFSERVICE_TOKO.md 2.2).
  @IsOptional() @IsInt() @Min(0) kuotaTokoMaksimal?: number;
}

export class UpdateSubSellerDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(64) contact?: string;
  @IsOptional() @IsString() @MaxLength(255) loginEmail?: string;
  @IsOptional() @IsString() @MaxLength(255) bankAccount?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) defaultRate?: number;
  @IsOptional() @IsInt() @Min(0) kuotaTokoMaksimal?: number;
  @IsOptional() @IsIn(["active", "inactive"]) status?: "active" | "inactive";
}

export class CreateSubSubSellerDto extends CreateSubSellerDto {
  @IsUUID() subSellerId!: string;
}

export class UpdateSubSubSellerDto extends UpdateSubSellerDto {}

// --- Shop assignment (hierarchy ownership) ---

export class AssignShopDto {
  // null clears the assignment. subSubSellerId requires subSellerId (checked in service).
  @IsOptional() @IsUUID() subSellerId?: string | null;
  @IsOptional() @IsUUID() subSubSellerId?: string | null;
  @IsOptional() @IsNumber() @Min(0) @Max(1) rateOverrideSubSeller?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(1) rateOverrideSubSubSeller?: number | null;
}

// --- Payout settings ---

export class UpdatePayoutSettingsDto {
  @IsOptional() @IsNumber() @Min(0) @Max(1) sedekahRate?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) materialReserveRate?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) defaultSubSellerRate?: number;
  @IsOptional() @IsIn(SEDEKAH_BASES) sedekahBasis?: (typeof SEDEKAH_BASES)[number];
  @IsOptional() @IsString() @MaxLength(255) sedekahBankAccount?: string;
  @IsOptional() @IsString() @MaxLength(255) materialBankAccount?: string;
}

// --- Mutation (Tahap 1 — one record per shop's pencairan) ---

export class CreateMutationDto {
  @IsUUID() batchId!: string;
  @IsUUID() shopId!: string;
  @IsDateString() payoutDate!: string;
  // The split calculation basis AND the marketplace proof figure are now one
  // and the same field (no more separate "Nominal Kredit" input) — this IS
  // marketplaceProofAmount, required.
  @IsNumber() @Min(0) marketplaceProofAmount!: number;
  // What Titik 1 OCR originally suggested, if the client ran OCR before
  // submitting. If this differs from marketplaceProofAmount above, the
  // service records it as an OCR correction signal. Omit if OCR wasn't used
  // or found nothing.
  @IsOptional() @IsNumber() @Min(0) ocrSuggestedAmount?: number;
  @IsOptional() @IsString() @MaxLength(255) receivingAccount?: string;
  @IsOptional() @IsString() @MaxLength(1024) marketplaceProofUrl?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) orderRefIds?: string[];
  @IsOptional() @IsString() note?: string;
}

export class UpdateMutationDto {
  @IsOptional() @IsDateString() payoutDate?: string;
  @IsOptional() @IsNumber() @Min(0) marketplaceProofAmount?: number;
  @IsOptional() @IsString() @MaxLength(255) receivingAccount?: string;
  @IsOptional() @IsString() @MaxLength(1024) marketplaceProofUrl?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) orderRefIds?: string[];
  @IsOptional() @IsString() note?: string;
}

export class ListMutationQueryDto {
  @IsOptional() @IsUUID() batchId?: string;
  @IsOptional() @IsUUID() shopId?: string;
  @IsOptional() @IsIn(["draft", "completed"]) status?: "draft" | "completed";
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

// --- Disbursements (Tahap 3 — one row per outgoing transfer) ---

export class UploadDisbursementProofDto {
  @IsString() @MaxLength(1024) proofUrl!: string;
}

export class OverrideDisbursementDto {
  @IsString() reason!: string;
}

// --- Adjustment (correction against a locked mutation) ---

export class CreateAdjustmentDto {
  @IsUUID() mutationId!: string;
  @IsNumber() amount!: number; // signed
  @IsString() reason!: string;
}

// --- OCR (Tahap 1, Titik 1 — pencairan proof pre-fill preview) ---

export class OcrExtractDto {
  @IsString() @MaxLength(1024) imageUrl!: string;
}

export class ReopenBatchDto {
  /** Explicitly accept losing transfer proofs already uploaded. */
  @IsOptional() @IsBoolean() force?: boolean;
}
