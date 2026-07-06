export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(2)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}
