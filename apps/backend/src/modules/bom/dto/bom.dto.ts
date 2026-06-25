import {
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

const RESTOCK_METHODS = ["wa_owner", "wa_supplier", "supplier_api"] as const;
type RestockMethod = (typeof RESTOCK_METHODS)[number];

export class CreateBomDto {
  @IsUUID()
  masterProductId!: string;

  @IsString()
  @MaxLength(255)
  materialName!: string;

  // numeric columns are strings in Drizzle.
  @IsNumberString()
  quantity!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @IsOptional()
  @IsNumberString()
  currentStock?: string;

  @IsOptional()
  @IsNumberString()
  minimumThreshold?: string;

  @IsOptional()
  @IsIn(RESTOCK_METHODS)
  restockMethod?: RestockMethod;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  supplierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  supplierShopeeUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  supplierWaNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  supplierApiUrl?: string;

  @IsOptional()
  @IsString()
  supplierApiKey?: string;

  @IsOptional()
  @IsNumberString()
  restockQty?: string;

  @IsOptional()
  @IsNumberString()
  restockPrice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  shippingAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  receiverName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  receiverPhone?: string;

  @IsOptional()
  @IsString()
  notesForSupplier?: string;
}

export class UpdateBomDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  materialName?: string;

  @IsOptional()
  @IsNumberString()
  quantity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @IsOptional()
  @IsNumberString()
  currentStock?: string;

  @IsOptional()
  @IsNumberString()
  minimumThreshold?: string;

  @IsOptional()
  @IsIn(RESTOCK_METHODS)
  restockMethod?: RestockMethod;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  supplierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  supplierShopeeUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  supplierWaNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  supplierApiUrl?: string;

  @IsOptional()
  @IsString()
  supplierApiKey?: string;

  @IsOptional()
  @IsNumberString()
  restockQty?: string;

  @IsOptional()
  @IsNumberString()
  restockPrice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  shippingAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  receiverName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  receiverPhone?: string;

  @IsOptional()
  @IsString()
  notesForSupplier?: string;
}

export class RestockDto {
  @IsOptional()
  @IsNumberString()
  amount?: string;
}
