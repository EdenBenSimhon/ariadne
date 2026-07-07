import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ApiConfigModule } from './config/config.module';
import { FlowsModule } from './flows/flows.module';
import { HealthModule } from './health/health.module';
import { InsightsModule } from './insights/insights.module';
import { LiveModule } from './live/live.module';
import { ApiKeyGuard } from './security/api-key.guard';
import { RateLimitGuard } from './security/rate-limit.guard';
import { SpansModule } from './spans/spans.module';
import { StatsModule } from './stats/stats.module';
import { TopologyModule } from './topology/topology.module';
import { TracesModule } from './traces/traces.module';

@Module({
  imports: [
    ApiConfigModule,
    TracesModule,
    SpansModule,
    TopologyModule,
    FlowsModule,
    InsightsModule,
    StatsModule,
    LiveModule,
    HealthModule,
  ],
  providers: [
    // Order matters: authenticate before spending rate-limit budget on a caller.
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
