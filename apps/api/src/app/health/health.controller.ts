import type { TraceReader } from '@ariadne/storage';
import { Controller, Get, Inject } from '@nestjs/common';
import { TRACE_READER } from '../storage/storage.module';

@Controller()
export class HealthController {
  constructor(@Inject(TRACE_READER) private readonly reader: TraceReader) {}

  @Get('healthz')
  async health() {
    let db: 'ok' | 'error' = 'ok';
    try {
      await this.reader.ping();
    } catch {
      db = 'error';
    }
    return { status: db, db };
  }
}
