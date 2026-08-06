import { Type } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class UpdateMaterialDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(32) unit?: string;
  @IsOptional() @IsNumber() @Min(0) minimumThreshold?: number;
  /** Overrides the weighted average until the next purchase recomputes it. */
  @IsOptional() @IsNumber() @Min(0) unitCost?: number;
  /** Manual stock adjustment, e.g. after a stock count. */
  @IsOptional() @IsNumber() @Min(0) currentStock?: number;
}

export class ParseReceiptDto {
  @IsString() imageUrl!: string;
}

export class PurchaseLineDto {
  /** Set when topping up an existing material; otherwise materialName creates one. */
  @IsOptional() @IsUUID() materialId?: string;
  @IsOptional() @IsString() @MaxLength(255) materialName?: string;
  @IsOptional() @IsString() @MaxLength(32) unit?: string;
  @IsNumber() @Min(0) quantity!: number;
  @IsNumber() @Min(0) totalCost!: number;
}

export class CreatePurchaseDto {
  @IsDateString() purchasedAt!: string;
  @IsOptional() @IsString() @MaxLength(255) supplierName?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() receiptUrl?: string;
  /** Raw OCR output kept for auditing and for improving the parser later. */
  @IsOptional() ocrRaw?: unknown;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  items!: PurchaseLineDto[];
}
