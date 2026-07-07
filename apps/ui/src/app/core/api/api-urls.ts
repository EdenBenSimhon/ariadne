export interface TraceListParams {
  readonly limit?: number;
  readonly cursor?: string | null;
  readonly service?: string | null;
  readonly status?: 'ok' | 'error' | null;
}

export function tracesUrl(params: TraceListParams = {}): string {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.service) search.set('service', params.service);
  if (params.status) search.set('status', params.status);
  const query = search.toString();
  return query.length > 0 ? `/api/traces?${query}` : '/api/traces';
}

export function traceUrl(traceId: string): string {
  return `/api/traces/${encodeURIComponent(traceId)}`;
}

export function topologyUrl(): string {
  return '/api/topology';
}

export function flowsUrl(sampleSize = 50): string {
  return `/api/flows?sampleSize=${sampleSize}`;
}

export function anomaliesUrl(sampleSize = 50): string {
  return `/api/anomalies?sampleSize=${sampleSize}`;
}

export function statsUrl(): string {
  return '/api/stats';
}

export interface LiveStreamParams {
  /** EventSource can't set headers, so the tenant travels in the query. */
  readonly tenantId: string;
  readonly backfill?: number;
  readonly types?: string;
}

export function eventsUrl(params: LiveStreamParams): string {
  const search = new URLSearchParams({ tenantId: params.tenantId });
  if (params.backfill !== undefined) search.set('backfill', String(params.backfill));
  if (params.types) search.set('types', params.types);
  return `/api/events?${search.toString()}`;
}

export function recentActivityUrl(limit = 25): string {
  return `/api/events/recent?limit=${limit}`;
}
