import { Global, Module } from '@nestjs/common';
import { COLLECTOR_CONFIG, loadCollectorConfig } from './collector-config';

@Global()
@Module({
  providers: [{ provide: COLLECTOR_CONFIG, useFactory: () => loadCollectorConfig() }],
  exports: [COLLECTOR_CONFIG],
})
export class CollectorConfigModule {}
