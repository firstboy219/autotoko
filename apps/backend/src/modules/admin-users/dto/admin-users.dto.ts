import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { Type } from "class-transformer";

const PLAN_TYPES = ["freemium", "starter", "pro"] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

export class ListUsersQueryDto {
  @IsOptional() @IsString() @MaxLength(255) search?: string;
  @IsOptional() @IsIn(PLAN_TYPES) plan?: PlanType;
  @IsOptional() @IsIn(["active", "suspended", "inactive"]) status?: "active" | "suspended" | "inactive";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(255) fullName?: string;
  @IsOptional() @IsIn(PLAN_TYPES) planType?: PlanType;
  // ISO date string to set, or null to clear. Loosely typed on purpose — an
  // internal admin-only field, coerced/validated in the service instead.
  @IsOptional() planExpiredAt?: string | null;
}
