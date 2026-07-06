export interface RestTransportConfig {
  /** Base URL request targets are resolved against; absolute targets win. */
  readonly baseUrl?: string;
  /** Default per-request timeout. Defaults to 30s. */
  readonly timeoutMs?: number;
  /** Static extra headers stamped on every request (e.g. auth). Trace headers win on conflict. */
  readonly headers?: Readonly<Record<string, string>>;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
