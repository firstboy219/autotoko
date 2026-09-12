import { Controller, Get } from "@nestjs/common";
import type { ApiResponse } from "@autotoko/shared";
import { BrandingService, type Branding } from "./branding.service.js";

// Public — the web & admin SPAs fetch this before auth to theme the login page.
@Controller("branding")
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get()
  async get(): Promise<ApiResponse<Branding>> {
    return { success: true, data: await this.branding.get() };
  }
}
