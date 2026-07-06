import { createStorageDb, PgTraceStore, type TraceStore } from '@ariadne/storage';
import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { COLLECTOR_CONFIG, type CollectorConfig } from '../config/collector-config';

export const TRACE_STORE = Symbol('TRACE_STORE');

/**
 * Closes the pool on shutdown. Runs AFTER the consumer stops: IngestionModule
 * imports this module, so Nest destroys ingestion first, and pool teardown
 * uses onApplicationShutdown (after all onModuleDestroy hooks).
 */
@Injectable()
class StorageLifecycle implements OnApplicationShutdown {
  constructor(@Inject(TRACE_STORE) private readonly store: TraceStore) {}

  async onApplicationShutdown(): Promise<void> {
    await this.store.close();
  }
}

@Module({
  providers: [
    {
      provide: TRACE_STORE,
      useFactory: (config: CollectorConfig): TraceStore => {
        // Connects as eventtracer_collector (INSERT/UPSERT only, security B2);
        // migrations run separately as the owner via `nx run storage:migrate`.
        const { db, pool } = createStorageDb({ url: config.databaseUrl, ssl: config.dbSsl });
        return new PgTraceStore(db, pool);
      },
      inject: [COLLECTOR_CONFIG],
    },
    StorageLifecycle,
  ],
  exports: [TRACE_STORE],
})
export class StorageModule {}
