import type { TraceStore } from '@ariadne/storage';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { COLLECTOR_CONFIG, type CollectorConfig } from '../config/collector-config';
import { TRACE_STORE } from '../storage/storage.module';

const DAY_MS = 86_400_000;
const BOOT_DELAY_MS = 60_000;

/**
 * Data retention: without this the partitioned spans table grows forever.
 * Once shortly after boot and then daily, call the owner-defined retention
 * function (migration 0004) to drop span partitions and delete trace/alert
 * rows older than COLLECTOR_RETENTION_DAYS. Failures only log — retention
 * must never take ingestion down with it.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @Inject(TRACE_STORE) private readonly store: TraceStore,
    @Inject(COLLECTOR_CONFIG) private readonly config: CollectorConfig
  ) {}

  onModuleInit(): void {
    if (this.config.retentionDays === 0) {
      this.logger.log('retention disabled (COLLECTOR_RETENTION_DAYS=0)');
      return;
    }
    // Delayed first run so boot-time DB pressure stays with ingestion.
    this.bootTimer = setTimeout(() => void this.sweep(), BOOT_DELAY_MS);
    this.timer = setInterval(() => void this.sweep(), DAY_MS);
    if (typeof this.bootTimer.unref === 'function') this.bootTimer.unref();
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.bootTimer !== null) clearTimeout(this.bootTimer);
    if (this.timer !== null) clearInterval(this.timer);
    this.bootTimer = null;
    this.timer = null;
  }

  async sweep(): Promise<void> {
    try {
      const dropped = await this.store.runRetention(this.config.retentionDays);
      this.logger.log(
        `retention sweep done — keep ${this.config.retentionDays}d, dropped ${dropped} span partition(s)`
      );
    } catch (err) {
      this.logger.warn(
        `retention sweep failed: ${err instanceof Error ? err.message : 'unknown'}`
      );
    }
  }
}
