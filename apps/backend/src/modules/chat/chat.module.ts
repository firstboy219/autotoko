import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MarketplaceSyncModule } from "../marketplace-sync/marketplace-sync.module.js";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";
import { ChatAutomationService } from "./chat-automation.service.js";
import { KbModule } from "../kb/kb.module.js";
import { AiModule } from "../ai/ai.module.js";

@Module({
  imports: [AuthModule, MarketplaceSyncModule, KbModule, AiModule],
  controllers: [ChatController],
  providers: [ChatService, ChatAutomationService],
  exports: [ChatService, ChatAutomationService],
})
export class ChatModule {}
