import { Module } from '@nestjs/common';
import { ApiConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { StatsModule } from './stats/stats.module';
import { TopologyModule } from './topology/topology.module';
import { TracesModule } from './traces/traces.module';

@Module({
  imports: [ApiConfigModule, TracesModule, TopologyModule, StatsModule, HealthModule],
})
export class AppModule {}
