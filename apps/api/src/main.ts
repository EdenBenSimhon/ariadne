import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { API_CONFIG, type ApiConfig } from './app/config/api-config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  // Open CORS for local dev (UI on :4200); tightened with auth in Phase 6.
  app.enableCors({ origin: true });
  const config = app.get<ApiConfig>(API_CONFIG);
  await app.listen(config.port);
  Logger.log(`🔎 API up — http://localhost:${config.port}/api (health: /api/healthz)`);
}

bootstrap();
