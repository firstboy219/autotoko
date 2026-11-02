import { Module } from "@nestjs/common";
import { JarvisController } from "./jarvis.controller.js";

@Module({ controllers: [JarvisController] })
export class JarvisIntegrationModule {}
