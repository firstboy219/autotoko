import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

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

export class PasswordLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class SetPasswordDto {
  @IsString()
  @MinLength(8, { message: "Password minimal 8 karakter." })
  newPassword!: string;

  /** Required only when replacing an existing password. */
  @IsOptional()
  @IsString()
  currentPassword?: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(20, { message: "Tautan tidak valid." })
  token!: string;

  @IsString()
  @MinLength(8, { message: "Password minimal 8 karakter." })
  newPassword!: string;
}
