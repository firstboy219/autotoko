import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { IsString, IsIn, MaxLength } from "class-validator";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { UploadsService } from "./uploads.service.js";

export class UploadImageDto {
  @IsString() @MaxLength(12_000_000) base64!: string;
  @IsIn(["jpg", "jpeg", "png", "webp"]) ext!: string;
}

@Controller("uploads")
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** Authenticated: store a base64 image, return its URL path. */
  @Post()
  @UseGuards(JwtAuthGuard)
  async upload(@Body() dto: UploadImageDto): Promise<ApiResponse<{ url: string }>> {
    const { url } = await this.uploads.saveImage(dto.base64, dto.ext);
    return { success: true, data: { url } };
  }

  /** Public: serve a stored image (proof screenshots are shown in <img> tags). */
  @Get(":name")
  async serve(@Param("name") name: string, @Res() reply: FastifyReply): Promise<void> {
    const { buffer, contentType } = await this.uploads.readImage(name);
    reply
      .header("Content-Type", contentType)
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .send(buffer);
  }
}
