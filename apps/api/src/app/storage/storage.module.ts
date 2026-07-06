import { createStorageDb, TraceReader } from '@ariadne/storage';
import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/api-config';

export const TRACE_READER = Symbol('TRACE_READER');

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
      provide: TRACE_READER,
      useFactory: (config: ApiConfig): TraceReader => {
        // SELECT-only role: even an injection bug in the read path cannot write (B2/B3).
        const { db, pool } = createStorageDb({ url: config.databaseUrl, ssl: config.dbSsl });
        return new TraceReader(db, pool);
      },
      inject: [API_CONFIG],
    },
    ReaderLifecycle,
  ],
  exports: [TRACE_READER],
})
export class ApiStorageModule {}
