import { IsIn, IsNumber, IsOptional, Max, Min } from "class-validator";

const RATE = { min: 0, max: 1 };

export class UpdateCostingDto {
  @IsOptional() @IsNumber() @Min(0) serviceCostPerPcs?: number;
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

export class SuggestPriceDto {
  @IsIn(["margin", "profit"]) kind!: "margin" | "profit";
  /** Fraction in [0,1] when kind=margin; rupiah when kind=profit. */
  @IsNumber() @Min(0) value!: number;
}
