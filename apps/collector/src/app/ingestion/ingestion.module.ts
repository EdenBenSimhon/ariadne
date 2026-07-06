import { Module } from '@nestjs/common';
import { HealthController } from '../health/health.controller';
import { StorageModule } from '../storage/storage.module';
import { IngestionMetrics } from './ingestion-metrics';
import { TracingConsumerService } from './tracing-consumer.service';

@Module({
  imports: [StorageModule],
  controllers: [HealthController],
  providers: [IngestionMetrics, TracingConsumerService],
})
export class IngestionModule {}
