import { Module } from '@nestjs/common';
import { CollectorConfigModule } from './config/config.module';
import { IngestionModule } from './ingestion/ingestion.module';

@Module({
  imports: [CollectorConfigModule, IngestionModule],
})
export class AppModule {}
