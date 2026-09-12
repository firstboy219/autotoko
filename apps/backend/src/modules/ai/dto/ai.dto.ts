import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { AI_PROVIDERS, type AiProvider } from "../ai.types.js";

export class SetFeatureConfigDto {
  @IsIn(AI_PROVIDERS)
  provider!: AiProvider;

  @IsString()
  model!: string;

  /** When true, the feature runs automatically (e.g. auto-approve on new order). */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class ChatMessageDto {
  @IsIn(["user", "assistant"])
  role!: "user" | "assistant";

  @IsString()
  content!: string;
}

export class BuyerChatDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];

  @IsOptional()
  @IsString()
  storeName?: string;

  @IsOptional()
  @IsString()
  productContext?: string;
}

export class AffiliateChatDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];

  @IsOptional()
  @IsString()
  storeName?: string;

  @IsOptional()
  @IsString()
  commissionInfo?: string;
}

export class ReviewReplyDto {
  @IsString()
  review!: string;

  @IsOptional()
  @IsNumber()
  rating?: number;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @IsString()
  storeName?: string;
}

export class AutoApproveDto {
  @IsOptional()
  @IsNumber()
  total?: number;

  @IsOptional()
  @IsString()
  buyerName?: string;

  @IsOptional()
  @IsInt()
  itemCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class OptimizeProductDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  keywords?: string;
}
