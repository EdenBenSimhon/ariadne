import { Module } from '@nestjs/common';
import { FlowsModule } from '../flows/flows.module';
import { ApiStorageModule } from '../storage/storage.module';
import { AlertEvaluatorService } from './alert-evaluator.service';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

@Module({
  imports: [ApiStorageModule, FlowsModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertEvaluatorService],
})
export class AlertsModule {}
