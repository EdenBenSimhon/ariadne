import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { COLLECTOR_CONFIG, type CollectorConfig } from './app/config/collector-config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // SIGTERM → stop consumer (awaits in-flight batch) → close DB pool.
  app.enableShutdownHooks();
  const config = app.get<CollectorConfig>(COLLECTOR_CONFIG);
  await app.listen(config.port);
  Logger.log(`🛰  Collector up — health at http://localhost:${config.port}/healthz`);
}

bootstrap();
