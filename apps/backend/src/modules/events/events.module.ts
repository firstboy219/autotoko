import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { EventsGateway } from "./events.gateway.js";

// @Global so any module (e.g. webhooks) can inject EventsGateway to push events.
@Global()
@Module({
  imports: [AuthModule], // JwtService (AuthModule exports JwtModule)
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
