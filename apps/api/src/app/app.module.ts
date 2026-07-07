import { Module } from '@nestjs/common';
import { ApiConfigModule } from './config/config.module';
import { FlowsModule } from './flows/flows.module';
import { HealthModule } from './health/health.module';
import { LiveModule } from './live/live.module';
import { StatsModule } from './stats/stats.module';
import { TopologyModule } from './topology/topology.module';
import { TracesModule } from './traces/traces.module';

@Module({
  imports: [
    ApiConfigModule,
    TracesModule,
    TopologyModule,
    FlowsModule,
    StatsModule,
    LiveModule,
    HealthModule,
  ],
})
export class AppModule {}
