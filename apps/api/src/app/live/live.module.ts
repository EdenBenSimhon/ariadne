import { Module } from '@nestjs/common';
import { ApiStorageModule } from '../storage/storage.module';
import { LiveController } from './live.controller';
import { LiveEventsService } from './live-events.service';

/** Realtime (SSE) + recent-activity snapshot over the SELECT-only reader. */
@Module({
  imports: [ApiStorageModule],
  controllers: [LiveController],
  providers: [LiveEventsService],
})
export class LiveModule {}
