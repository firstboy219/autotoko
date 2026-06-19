import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AuthService } from "./auth.service.js";
import { EmailOtpService } from "./email-otp.service.js";
import { AuthController } from "./auth.controller.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_SECRET", "dev-insecure-jwt-secret"),
        signOptions: { expiresIn: config.get<string>("JWT_EXPIRES_IN", "1h") },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, EmailOtpService, JwtAuthGuard],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
