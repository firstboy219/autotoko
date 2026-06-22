import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
    // rawBody is needed to verify marketplace webhook HMAC signatures over the
    // exact bytes received (parsed JSON would re-serialize differently).
    { rawBody: true },
  );

  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.enableCors();

  const config = app.get(ConfigService);
  const port = config.get<number>("PORT", 8080);
  const host = config.get<string>("HOST", "0.0.0.0");

  await app.listen(port, host);
  Logger.log(`AutoToko backend listening on http://${host}:${port}/api`, "Bootstrap");
}

void bootstrap();
