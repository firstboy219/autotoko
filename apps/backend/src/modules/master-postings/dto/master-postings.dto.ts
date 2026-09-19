import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";

export class CreateMasterPostingDto {
  @IsString() @MaxLength(255) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() categoryId?: number;
  @IsOptional() @IsString() @MaxLength(255) brand?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) images?: string[];
  /** [{ name:"Warna", values:["Biru","Merah"] }, ...] — divalidasi longgar, dibereskan di service. */
  @IsOptional() @IsArray() variantGroups?: { name: string; values: string[] }[];
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
  @IsOptional() @IsBoolean() autoApply?: boolean;
  @IsOptional() @IsString() @MaxLength(20) status?: string;
}

export class UpdateMasterPostingDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() categoryId?: number;
  @IsOptional() @IsString() @MaxLength(255) brand?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) images?: string[];
  @IsOptional() @IsArray() variantGroups?: { name: string; values: string[] }[];
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
  @IsOptional() @IsBoolean() autoApply?: boolean;
  @IsOptional() @IsString() @MaxLength(20) status?: string;
}

export class SetSkuDto {
  @IsOptional() @IsString() @MaxLength(128) sku?: string;
  @IsOptional() @IsUUID() masterProductId?: string | null;
  @IsOptional() @IsNumberString() price?: string;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsString() imageUrl?: string;
}

export class AddMappingDto {
  @IsUUID() shopId!: string;
  /** Wajib untuk mode "update" (listing yang diperbarui); kosong untuk mode "create". */
  @IsOptional() @IsString() @MaxLength(64) productId?: string;
  @IsOptional() @IsString() @MaxLength(32) marketplace?: string;
  /** "update" = perbarui listing yang ada; "create" = jadikan posting baru di toko ini. */
  @IsOptional() @IsString() @MaxLength(20) mode?: string;
}
