import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

const PRODUCT_STATUS = ["active", "inactive", "draft"] as const;
const POSTING_STATUS = [
  "active",
  "inactive",
  "deleted",
  "under_review",
  "banned",
] as const;

export class CreateMasterDto {
  @IsString()
  @MaxLength(128)
  sku!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsNumberString()
  basePrice?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  weightGram?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsEnum(PRODUCT_STATUS)
  status?: (typeof PRODUCT_STATUS)[number];
}

export class UpdateMasterDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() categoryId?: number;
  @IsOptional() @IsNumberString() basePrice?: string;
  @IsOptional() @IsInt() @Min(0) weightGram?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) images?: string[];
  @IsOptional() @IsEnum(PRODUCT_STATUS) status?: (typeof PRODUCT_STATUS)[number];
}

export class CreatePostingDto {
  @IsString()
  shopId!: string;

  // SKU used on the marketplace — the link key to a master product (PRD 6.1).
  @IsString()
  @MaxLength(128)
  marketplaceSku!: string;

  @IsOptional() @IsString() @MaxLength(128) marketplaceItemId?: string;
  @IsOptional() @IsString() @MaxLength(500) title?: string;
  @IsOptional() @IsNumberString() price?: string;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsEnum(POSTING_STATUS) status?: (typeof POSTING_STATUS)[number];
}
