import { Module } from '@nestjs/common';
import { ApiStorageModule } from '../storage/storage.module';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

@Module({
  imports: [ApiStorageModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
