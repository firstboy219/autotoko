import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ApiResponse } from "@autotoko/shared";
import { JwtAuthGuard, AdminOnly, type JwtPayload } from "../auth/jwt-auth.guard.js";
import { AdminSettingsService } from "../admin-settings/admin-settings.service.js";
import { AiProviderService } from "./ai-provider.service.js";
import { AiService } from "./ai.service.js";
import { AutopilotLogService } from "./autopilot-log.service.js";
import {
  AffiliateChatDto,
  AutoApproveDto,
  BuyerChatDto,
  OptimizeProductDto,
  ReviewReplyDto,
  SetFeatureConfigDto,
} from "./dto/ai.dto.js";

@Controller("ai")
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly provider: AiProviderService,
    private readonly settings: AdminSettingsService,
    private readonly activity: AutopilotLogService,
  ) {}

  /** Recent autopilot actions for the signed-in seller (monitorable feed). */
  @Get("activity")
  async listActivity(
    @Req() req: FastifyRequest,
    @Query("limit") limit?: string,
  ): Promise<ApiResponse<unknown[]>> {
    const user = (req as FastifyRequest & { user?: JwtPayload }).user!;
    const rows = await this.activity.list(user.sub, limit ? Number(limit) : 50);
    return { success: true, data: rows };
  }

  /** CMS: list features + their assigned provider/model + provider key status. */
  @Get("features")
  @AdminOnly()
  async features(): Promise<ApiResponse<Awaited<ReturnType<AiProviderService["featureStatus"]>>>> {
    return { success: true, data: await this.provider.featureStatus() };
  }

  /** CMS: assign a provider+model to a feature. */
  @Put("features/:feature")
  @AdminOnly()
  async setFeature(
    @Param("feature") feature: string,
    @Body() dto: SetFeatureConfigDto,
  ): Promise<ApiResponse<{ feature: string }>> {
    await this.settings.set(`ai_feature_${feature}_provider`, dto.provider);
    await this.settings.set(`ai_feature_${feature}_model`, dto.model);
    if (dto.enabled !== undefined) {
      await this.settings.set(`ai_feature_${feature}_enabled`, String(dto.enabled));
    }
    return { success: true, data: { feature } };
  }

  @Post("buyer-chat")
  async buyerChat(@Body() dto: BuyerChatDto): Promise<ApiResponse<{ reply: string }>> {
    return { success: true, data: { reply: await this.ai.buyerChat(dto) } };
  }

  @Post("affiliate-chat")
  async affiliateChat(@Body() dto: AffiliateChatDto): Promise<ApiResponse<{ reply: string }>> {
    return { success: true, data: { reply: await this.ai.affiliateChat(dto) } };
  }

  @Post("review-reply")
  async reviewReply(@Body() dto: ReviewReplyDto): Promise<ApiResponse<{ reply: string }>> {
    return { success: true, data: { reply: await this.ai.reviewReply(dto) } };
  }

  @Post("auto-approve")
  async autoApprove(
    @Body() dto: AutoApproveDto,
  ): Promise<ApiResponse<{ approve: boolean; reason: string }>> {
    return { success: true, data: await this.ai.autoApprove(dto) };
  }

  @Post("optimize-product")
  async optimizeProduct(
    @Body() dto: OptimizeProductDto,
  ): Promise<ApiResponse<{ title: string; description: string }>> {
    return { success: true, data: await this.ai.optimizeProduct(dto) };
  }
}
