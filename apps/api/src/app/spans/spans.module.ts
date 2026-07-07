import { Module } from '@nestjs/common';
import { ApiStorageModule } from '../storage/storage.module';
import { SpansController } from './spans.controller';
import { SpansService } from './spans.service';

@Module({
  imports: [ApiStorageModule],
  controllers: [SpansController],
  providers: [SpansService],
})
export class SpansModule {}
