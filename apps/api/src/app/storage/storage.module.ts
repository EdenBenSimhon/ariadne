import {
  AlertStore,
  createStorageDb,
  InsightStore,
  TraceReader,
  type StorageDb,
} from '@ariadne/storage';
import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';
import { API_CONFIG, type ApiConfig } from '../config/api-config';

export const TRACE_READER = Symbol('TRACE_READER');
export const INSIGHT_STORE = Symbol('INSIGHT_STORE');
export const ALERT_STORE = Symbol('ALERT_STORE');
const STORAGE_HANDLE = Symbol('STORAGE_HANDLE');

interface StorageHandle {
  readonly db: StorageDb;
  readonly pool: Pool;
}

@Injectable()
class ReaderLifecycle implements OnApplicationShutdown {
  constructor(@Inject(TRACE_READER) private readonly reader: TraceReader) {}

  async onApplicationShutdown(): Promise<void> {
    await this.reader.close();
  }
}

@Module({
  providers: [
    {
      provide: STORAGE_HANDLE,
      useFactory: (config: ApiConfig): StorageHandle =>
        // The reader role can SELECT trace data but never write it; its only
        // writable table is insights (B2/B3) — see migration 0003.
        createStorageDb({ url: config.databaseUrl, ssl: config.dbSsl }),
      inject: [API_CONFIG],
    },
    {
      provide: TRACE_READER,
      useFactory: (storage: StorageHandle): TraceReader =>
        new TraceReader(storage.db, storage.pool),
      inject: [STORAGE_HANDLE],
    },
    {
      provide: INSIGHT_STORE,
      useFactory: (storage: StorageHandle): InsightStore => new InsightStore(storage.db),
      inject: [STORAGE_HANDLE],
    },
    {
      provide: ALERT_STORE,
      useFactory: (storage: StorageHandle): AlertStore => new AlertStore(storage.db),
      inject: [STORAGE_HANDLE],
    },
    ReaderLifecycle,
  ],
  exports: [TRACE_READER, INSIGHT_STORE, ALERT_STORE],
})
export class ApiStorageModule {}
