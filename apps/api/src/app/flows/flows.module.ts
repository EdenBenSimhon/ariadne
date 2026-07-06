import { Module } from '@nestjs/common';
import { ApiStorageModule } from '../storage/storage.module';
import { TopologyModule } from '../topology/topology.module';
import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';

@Module({
  imports: [ApiStorageModule, TopologyModule],
  controllers: [FlowsController],
  providers: [FlowsService],
})
export class FlowsModule {}
