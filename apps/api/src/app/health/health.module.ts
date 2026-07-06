import { Module } from '@nestjs/common';
import { ApiStorageModule } from '../storage/storage.module';
import { HealthController } from './health.controller';

@Module({
  imports: [ApiStorageModule],
  controllers: [HealthController],
})
export class HealthModule {}
