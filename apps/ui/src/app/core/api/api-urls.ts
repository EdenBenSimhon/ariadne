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

export interface SpanSearchParams {
  readonly limit?: number;
  readonly cursor?: string | null;
  readonly q?: string | null;
  readonly service?: string | null;
  readonly channel?: string | null;
  readonly status?: 'OK' | 'ERROR' | null;
  readonly transport?: string | null;
  readonly minDurationMs?: number | null;
  readonly metaKey?: string | null;
  readonly metaValue?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
}

/** Logger-style span search (`/api/spans`). */
export function spansUrl(params: SpanSearchParams = {}): string {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.q) search.set('q', params.q);
  if (params.service) search.set('service', params.service);
  if (params.channel) search.set('channel', params.channel);
  if (params.status) search.set('status', params.status);
  if (params.transport) search.set('transport', params.transport);
  if (params.minDurationMs) search.set('minDurationMs', String(params.minDurationMs));
  if (params.metaKey) search.set('metaKey', params.metaKey);
  if (params.metaValue) search.set('metaValue', params.metaValue);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  const query = search.toString();
  return query.length > 0 ? `/api/spans?${query}` : '/api/spans';
}

export function servicesUrl(): string {
  return '/api/services';
}

export function flowChangesUrl(windowHours = 24, sampleSize = 50): string {
  return `/api/flows/changes?windowHours=${windowHours}&sampleSize=${sampleSize}`;
}

export function insightsUrl(limit = 50): string {
  return `/api/insights?limit=${limit}`;
}

export function insightUrl(insightId: string): string {
  return `/api/insights/${encodeURIComponent(insightId)}`;
}
