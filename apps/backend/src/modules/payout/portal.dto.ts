import { IsString, MinLength } from "class-validator";

export class PortalEmailStartDto {
  @IsString() email!: string;
}

export class PortalEmailVerifyDto {
  @IsString() email!: string;
  @IsString() @MinLength(4) code!: string;
}
