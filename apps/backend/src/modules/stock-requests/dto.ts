import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class ItemRequestDto {
  /** Boleh kosong: bahan yang belum ada di master tetap boleh diminta. */
  @IsOptional() @IsUUID() materialId?: string;
  @IsOptional() @IsString() @MaxLength(255) rawName?: string;

  @IsNumber() @Min(0) qtyPack!: number;
  @IsOptional() @IsString() @MaxLength(32) packLabel?: string;
  @IsOptional() @IsNumber() @Min(0) contentPerPack?: number;
  @IsOptional() @IsString() @MaxLength(16) contentUnit?: string;
  @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
}

export class SimpanRequestDto {
  /** Wajib. Lihat alasannya di StockRequestsService. */
  @IsString() @MaxLength(1024) screenshotUrl!: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ItemRequestDto)
  items!: ItemRequestDto[];
}
