import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, AdminOnly } from "../auth/jwt-auth.guard.js";
import { AdminUsersService } from "./admin-users.service.js";
import { ListUsersQueryDto, UpdateUserDto } from "./dto/admin-users.dto.js";

const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

@Controller("admin/users")
@UseGuards(JwtAuthGuard)
@AdminOnly()
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  async list(@Query() q: ListUsersQueryDto) {
    return ok(await this.service.list(q));
  }

  @Get(":id")
  async detail(@Param("id") id: string) {
    return ok(await this.service.detail(id));
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateUserDto) {
    return ok(await this.service.update(id, dto));
  }

  @Post(":id/suspend")
  async suspend(@Param("id") id: string) {
    return ok(await this.service.suspend(id));
  }

  @Post(":id/unsuspend")
  async unsuspend(@Param("id") id: string) {
    return ok(await this.service.unsuspend(id));
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    return ok(await this.service.remove(id));
  }

  /** Returns a one-time temporary password; only its hash is stored. */
  @Post(":id/reset-password")
  async resetPassword(@Param("id") id: string) {
    return ok(await this.service.resetPassword(id));
  }

  /** Reverts the account to OTP-only sign-in. */
  @Delete(":id/password")
  async clearPassword(@Param("id") id: string) {
    return ok(await this.service.clearPassword(id));
  }
}
