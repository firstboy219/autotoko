import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const RATE = { min: 0, max: 1 };

export class UpdateCostingDto {
  @IsOptional() @IsNumber() @Min(0) serviceCostPerPcs?: number;
  @IsOptional() @IsNumber() @Min(0) packingCostPerOrder?: number;
  /** Must stay > 0 — it is a divisor. */
  @IsOptional() @IsNumber() @Min(0.01) avgUnitsPerOrder?: number;
  @IsOptional() @IsNumber() @Min(0) publishPrice?: number | null;

  @IsOptional() @IsNumber() @Min(RATE.min) @Max(RATE.max) marketplaceFeeRate?: number;
  @IsOptional() @IsNumber() @Min(RATE.min) @Max(RATE.max) eventRate?: number;
  @IsOptional() @IsNumber() @Min(RATE.min) @Max(RATE.max) affiliatorRate?: number;
  @IsOptional() @IsNumber() @Min(RATE.min) @Max(RATE.max) adsRate?: number;
  @IsOptional() @IsNumber() @Min(0) adsFixedPerPcs?: number;
  @IsOptional() @IsNumber() @Min(RATE.min) @Max(RATE.max) sedekahRate?: number;
  @IsOptional() @IsNumber() @Min(RATE.min) @Max(RATE.max) resellerRate?: number;
  @IsOptional() @IsNumber() @Min(RATE.min) @Max(RATE.max) targetProfitRate?: number;
}

/** Only the two costing-relevant fields — full material management (supplier,
 *  restock, stock levels) stays in the BOM module. */
export class UpdateMaterialCostDto {
  @IsOptional() @IsNumber() @Min(0) quantity?: number;
  @IsOptional() @IsNumber() @Min(0) unitCost?: number;
}

/**
 * Adds a recipe line straight from the costing page. Deliberately only the
 * costing-relevant fields — supplier, restock method and stock levels keep
 * their column defaults and are configured in the BOM module if needed.
 */
export class CreateMaterialDto {
  // \S guards against both "" and whitespace-only — plain @IsString/@MaxLength
  // accepted an empty name, which produced a nameless row in the recipe.
  @IsString()
  @MaxLength(255)
  @Matches(/\S/, { message: "Nama bahan baku tidak boleh kosong" })
  materialName!: string;
  @IsNumber() @Min(0) quantity!: number;
  @IsOptional() @IsString() @MaxLength(32) unit?: string;
  @IsOptional() @IsNumber() @Min(0) unitCost?: number;
}

export class SuggestPriceDto {
  @IsIn(["margin", "profit"]) kind!: "margin" | "profit";
  /** Fraction in [0,1] when kind=margin; rupiah when kind=profit. */
  @IsNumber() @Min(0) value!: number;
}
