import { Module } from '@nestjs/common';
import { CollectorConfigModule } from './config/config.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { MaintenanceModule } from './maintenance/maintenance.module';

@Module({
  imports: [CollectorConfigModule, IngestionModule, MaintenanceModule],
})
export class AppModule {}
