import { Module } from '@nestjs/common';
import { ApiStorageModule } from '../storage/storage.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [ApiStorageModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
