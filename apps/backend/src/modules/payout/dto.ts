import {
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  IsUUID,
  IsArray,
  IsDateString,
  MaxLength,
  Min,
  Max,
} from "class-validator";

/**
 * DTOs for the Payout module. Rates are fractions in [0,1] (0.20 = 20%) end to
 * end — API, calc, and DB share one unit to avoid conversion bugs. Money fields
 * are rupiah numbers; the service converts to integer cents for the split.
 */

const SEDEKAH_BASES = ["total_credit", "after_subseller_split"] as const;

// --- Sub-seller / Sub-sub-seller ---

export class CreateSubSellerDto {
  @IsString() @MaxLength(255) name!: string;
  @IsOptional() @IsString() @MaxLength(64) contact?: string;
  @IsOptional() @IsString() @MaxLength(255) loginEmail?: string;
  @IsOptional() @IsString() @MaxLength(255) bankAccount?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) defaultRate?: number;
}

export class UpdateSubSellerDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(64) contact?: string;
  @IsOptional() @IsString() @MaxLength(255) loginEmail?: string;
  @IsOptional() @IsString() @MaxLength(255) bankAccount?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) defaultRate?: number;
  @IsOptional() @IsIn(["active", "inactive"]) status?: "active" | "inactive";
}

export class CreateSubSubSellerDto extends CreateSubSellerDto {
  @IsUUID() subSellerId!: string;
}

export class UpdateSubSubSellerDto extends UpdateSubSellerDto {}

// --- Shop assignment (requirement 5.3) ---

export class AssignShopDto {
  // null clears the assignment. subSubSellerId requires subSellerId (checked in service).
  @IsOptional() @IsUUID() subSellerId?: string | null;
  @IsOptional() @IsUUID() subSubSellerId?: string | null;
  @IsOptional() @IsNumber() @Min(0) @Max(1) rateOverrideSubSeller?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(1) rateOverrideSubSubSeller?: number | null;
}

// --- Payout settings (requirement 5.4) ---

export class UpdatePayoutSettingsDto {
  @IsOptional() @IsNumber() @Min(0) @Max(1) sedekahRate?: number;
  @IsOptional() @IsIn(SEDEKAH_BASES) sedekahBasis?: (typeof SEDEKAH_BASES)[number];
  @IsOptional() @IsString() @MaxLength(255) sedekahBankAccount?: string;
}

// --- Batch (requirement 6.1) ---

export class MarkBatchTransferredDto {
  // Proof URL (uploaded to R2 by the client, then passed here). Required to
  // move the batch to "transferred".
  @IsString() @MaxLength(1024) transferProofUrl!: string;
}

// --- Mutation (requirement 5.6 / 6.2) ---

export class CreateMutationDto {
  @IsUUID() batchId!: string;
  @IsUUID() shopId!: string;
  @IsDateString() payoutDate!: string;
  @IsNumber() @Min(0) creditAmount!: number;
  @IsOptional() @IsNumber() @Min(0) marketplaceProofAmount?: number;
  @IsOptional() @IsString() @MaxLength(255) receivingAccount?: string;
  @IsOptional() @IsString() @MaxLength(1024) marketplaceProofUrl?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) orderRefIds?: string[];
  @IsOptional() @IsString() note?: string;
}

export class UpdateMutationDto {
  @IsOptional() @IsDateString() payoutDate?: string;
  @IsOptional() @IsNumber() @Min(0) creditAmount?: number;
  @IsOptional() @IsNumber() @Min(0) marketplaceProofAmount?: number;
  @IsOptional() @IsString() @MaxLength(255) receivingAccount?: string;
  @IsOptional() @IsString() @MaxLength(1024) marketplaceProofUrl?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) orderRefIds?: string[];
  @IsOptional() @IsString() note?: string;
}

/** Proof URLs supplied when completing a mutation (validated per scenario). */
export class CompleteMutationDto {
  @IsOptional() @IsString() @MaxLength(1024) marketplaceProofUrl?: string;
  @IsOptional() @IsString() @MaxLength(1024) sedekahTransferProofUrl?: string;
  @IsOptional() @IsString() @MaxLength(1024) sellerTransferProofUrl?: string;
  @IsOptional() @IsString() @MaxLength(1024) subSellerTransferProofUrl?: string;
  @IsOptional() @IsString() @MaxLength(1024) subSubSellerTransferProofUrl?: string;
}

export class ListMutationQueryDto {
  @IsOptional() @IsUUID() batchId?: string;
  @IsOptional() @IsUUID() shopId?: string;
  @IsOptional() @IsIn(["draft", "completed"]) status?: "draft" | "completed";
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

// --- Adjustment (requirement 5.7 / 6.2) ---

export class CreateAdjustmentDto {
  @IsUUID() mutationId!: string;
  @IsNumber() amount!: number; // signed
  @IsString() reason!: string;
}
