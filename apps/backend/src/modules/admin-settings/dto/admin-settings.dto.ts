import { IsOptional, IsString } from "class-validator";

export class SetSettingDto {
  @IsString()
  value!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
