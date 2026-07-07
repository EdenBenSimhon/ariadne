import { HEADERS, tenantIdSchema, type TenantId } from '@ariadne/protocol';
import type { LiveEvent, LiveEventKind, RecentActivityResponse } from '@ariadne/graph';
import { BadRequestException, Controller, Get, Inject, Query, Req, Sse, type MessageEvent } from '@nestjs/common';
import { concat, filter, from, interval, map, merge, mergeMap, type Observable } from 'rxjs';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import { LiveEventsService } from './live-events.service';

const HEARTBEAT_MS = 15_000;
const DATA_KINDS: readonly LiveEventKind[] = ['trace'];

interface RequestLike {
  readonly headers: Record<string, string | string[] | undefined>;
}

/**
 * EventSource can't send custom headers, so the SSE endpoint accepts the
 * tenant as a query param (`?tenantId=`) as well as the usual header — still
 * required, still validated, no default tenant (security B3).
 */
function resolveTenant(req: RequestLike, tenantIdQuery: string | undefined): TenantId {
  const header = req.headers[HEADERS.TENANT_ID];
  const raw = tenantIdQuery ?? (Array.isArray(header) ? header[0] : header);
  const parsed = tenantIdSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException(`missing or invalid tenant (header ${HEADERS.TENANT_ID} or ?tenantId=)`);
  return parsed.data;
}

function parseKinds(raw: string | undefined): Set<LiveEventKind> {
  if (raw === undefined || raw.trim() === '') return new Set(DATA_KINDS);
  const requested = raw.split(',').map((part) => part.trim()).filter((part): part is LiveEventKind => (DATA_KINDS as readonly string[]).includes(part));
  return requested.length > 0 ? new Set(requested) : new Set(DATA_KINDS);
}

/**
 * Realtime + snapshot activity. `/api/events` is a Server-Sent-Events stream
 * (one connected trace = one event); `/api/events/recent` is the same data as
 * a plain JSON snapshot, which the MCP `get_recent_activity` tool reads.
 */
@Controller('events')
export class LiveController {
  constructor(
    private readonly live: LiveEventsService,
    @Inject(API_CONFIG) private readonly config: ApiConfig
  ) {}

  @Sse()
  events(
    @Req() req: RequestLike,
    @Query('tenantId') tenantIdQuery?: string,
    @Query('types') types?: string,
    @Query('backfill') backfill?: string
  ): Observable<MessageEvent> {
    const tenantId = resolveTenant(req, tenantIdQuery);
    const kinds = parseKinds(types);
    const backfillCount = this.clampBackfill(backfill);

    const backfill$: Observable<LiveEvent> =
      kinds.has('trace') && backfillCount > 0
        ? from(this.live.recent(tenantId, backfillCount)).pipe(mergeMap((events) => from(events)))
        : from([] as LiveEvent[]);

    const data$ = concat(backfill$, this.live.stream(tenantId)).pipe(filter((event) => kinds.has(event.kind as LiveEventKind)));
    const heartbeat$: Observable<LiveEvent> = interval(HEARTBEAT_MS).pipe(
      map(() => ({ kind: 'heartbeat', at: new Date().toISOString() }) as const)
    );

    return merge(data$, heartbeat$).pipe(
      map((event): MessageEvent => ({ type: event.kind, data: event as unknown as Record<string, unknown> }))
    );
  }

  @Get('recent')
  async recent(@Req() req: RequestLike, @Query('tenantId') tenantIdQuery?: string, @Query('limit') limit?: string): Promise<RecentActivityResponse> {
    const tenantId = resolveTenant(req, tenantIdQuery);
    return { events: await this.live.recent(tenantId, this.clampBackfill(limit)) };
  }

  private clampBackfill(raw: string | undefined): number {
    const value = raw === undefined ? this.config.liveStreamBackfill : Number(raw);
    if (!Number.isFinite(value)) return this.config.liveStreamBackfill;
    return Math.max(0, Math.min(this.config.maxPageSize, Math.floor(value)));
  }
}
