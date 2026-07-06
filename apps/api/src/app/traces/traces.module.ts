import { Module } from '@nestjs/common';
import { ApiStorageModule } from '../storage/storage.module';
import { TracesController } from './traces.controller';
import { TracesService } from './traces.service';

@Module({
  imports: [ApiStorageModule],
  controllers: [TracesController],
  providers: [TracesService],
})
export class TracesModule {}
