import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app/app.module';
import { requestLogger } from './app/common/request-logger.middleware';
import { API_CONFIG, type ApiConfig } from './app/config/api-config';
import { securityHeaders } from './app/security/security-headers.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ApiConfig>(API_CONFIG);

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app.disable('x-powered-by');
  app.use(requestLogger());
  app.use(securityHeaders(config.enableHsts));
  // Allowlist from API_CORS_ORIGINS; '*' (the dev default) reflects any origin.
  app.enableCors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['content-type', 'x-tenant-id', 'x-api-key', 'x-request-id'],
    maxAge: 600,
  });

  await app.listen(config.port);
  Logger.log(`🔎 API up — http://localhost:${config.port}/api (health: /api/healthz)`);
  if (Object.keys(config.apiKeys).length === 0) {
    Logger.warn('API_KEYS not set — API key auth is DISABLED (dev mode only)');
  }
}

bootstrap();
