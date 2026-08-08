import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

/**
 * Five buckets, ordered from empty to plenty.
 *
 * Five and not three because the middle is where the decision lives:
 * "cukup" means order now but the slow cheap way, "normal" means do nothing
 * this week. Collapsing those two turns every reading into panic or silence.
 */
export const STOCK_LEVELS = ["habis", "hampir_habis", "cukup", "normal", "banyak"] as const;

/** One material on an arriving parcel. */
export class DeliveryLineDto {
  @IsUUID() materialId!: string;

  /** What the waybill called it, kept beside the mapping rather than replacing it. */
  @IsOptional() @IsString() @MaxLength(255) rawName?: string;

  /** Packages received — bottles, sacks, rolls. */
  @Type(() => Number) @IsNumber() @Min(0.001) @Max(1_000_000) qtyPcs!: number;

  /**
   * How much of the material's OWN unit is in one package.
   *
   * A catalogue holding millilitres has to be told that a bottle is 100 of
   * them; without it a delivery of three bottles would add three millilitres.
   * 1 for anything already counted in pieces.
   */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1_000_000) contentPerPcs?: number;

  /**
   * The unit `contentPerPcs` was measured in, when it is not the catalogue's.
   *
   * A supplier ships glycerine in a 1 kg jug; the catalogue holds glycerine in
   * grams. Without this the packer had to do that conversion in their head
   * into a box labelled only "gram", and typing 1 for a 1 kg jug is the
   * obvious reading — it understates the shelf a thousandfold and nothing
   * downstream ever looks wrong. Omitted means it is already the catalogue's
   * unit.
   */
  @IsOptional() @IsString() @MaxLength(32) contentUnit?: string;

  /** Omit when unknown. Zero would drag the weighted average down. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) totalCost?: number;
}

export class RecordDeliveryDto {
  @IsString() @MaxLength(128) resi!: string;

  /** JPEG of the waybill, base64. */
  @IsOptional() @IsString() @MaxLength(12_000_000) photoBase64?: string;

  /** Everything the phone read, for comparing against what was mapped. */
  @IsOptional() @IsString() @MaxLength(20_000) deviceText?: string;

  @IsOptional() @IsString() @MaxLength(500) note?: string;

  /** Paid to the courier at the door. */
  @IsOptional() @IsBoolean() isCod?: boolean;

  /** Required by the app when isCod; the amount owed for the whole parcel. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1_000_000_000) codAmount?: number;

  @IsArray() @ValidateNested({ each: true }) @Type(() => DeliveryLineDto)
  items!: DeliveryLineDto[];
}

/** One line of a purchase being corrected. */
export class UpdatePurchaseLineDto {
  @IsUUID() materialId!: string;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.001) @Max(1_000_000) qtyPcs?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1_000_000) contentPerPcs?: number;

  /** The unit the line above was measured in; blank means the catalogue's. */
  @IsOptional() @IsString() @MaxLength(32) contentUnit?: string;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) totalCost?: number;
}

/**
 * A correction to a recorded purchase.
 *
 * Every field optional and every omission meaningful: sending only a note must
 * not blank the supplier, and sending no items must not wipe the parcel's
 * contents. Only `items` when present rewrites the lines.
 */
export class UpdatePurchaseDto {
  @IsOptional() @IsDateString() purchasedAt?: string;

  @IsOptional() @IsString() @MaxLength(255) supplierName?: string;

  @IsOptional() @IsString() @MaxLength(500) note?: string;

  @IsOptional() @IsBoolean() isCod?: boolean;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1_000_000_000) codAmount?: number;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => UpdatePurchaseLineDto)
  items?: UpdatePurchaseLineDto[];
}

export class CreateMaterialDto {
  @IsString() @MaxLength(255) name!: string;
  @IsOptional() @IsString() @MaxLength(32) unit?: string;
  @IsOptional() @IsNumber() @Min(0) unitCost?: number;
  @IsOptional() @IsNumber() @Min(0) currentStock?: number;
  @IsOptional() @IsNumber() @Min(0) minimumThreshold?: number;
}

export class UpdateMaterialDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(32) unit?: string;
  @IsOptional() @IsNumber() @Min(0) minimumThreshold?: number;
  /** What the shelf looks like, as opposed to what the books say. */
  @IsOptional() @IsIn(STOCK_LEVELS) stockLevel?: (typeof STOCK_LEVELS)[number];

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
