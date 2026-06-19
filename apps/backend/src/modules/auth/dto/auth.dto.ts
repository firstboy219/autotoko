import { IsOptional, IsString, MinLength } from "class-validator";

export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class WaVerifyDto {
  @IsString()
  code!: string;

  @IsString()
  wa_number!: string;
}

export class EmailStartDto {
  @IsString()
  email!: string;
}

export class EmailVerifyDto {
  @IsString()
  email!: string;

  @IsString()
  @MinLength(4)
  code!: string;
}

export class WaStartResponse {
  code!: string;
  callbackToken!: string;
  waLink!: string;
  expiresInSec!: number;
}

export class WaStatusQuery {
  @IsString()
  @IsOptional()
  token?: string;
}
