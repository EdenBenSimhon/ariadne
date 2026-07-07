import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { RetentionService } from './retention.service';

@Module({
  imports: [StorageModule],
  providers: [RetentionService],
})
export class MaintenanceModule {}
