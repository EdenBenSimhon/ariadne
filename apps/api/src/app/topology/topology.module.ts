import { Module } from '@nestjs/common';
import { ApiStorageModule } from '../storage/storage.module';
import { TopologyController } from './topology.controller';
import { TopologyService } from './topology.service';

@Module({
  imports: [ApiStorageModule],
  controllers: [TopologyController],
  providers: [TopologyService],
  exports: [TopologyService],
})
export class TopologyModule {}
