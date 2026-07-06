const PALETTE_SIZE = 8;

/** Deterministic service → palette-var mapping (`--svc-0` … `--svc-7`). */
export function serviceColor(serviceName: string): string {
  let hash = 0;
  for (let i = 0; i < serviceName.length; i += 1) {
    hash = (hash * 31 + serviceName.charCodeAt(i)) >>> 0;
  }
  return `var(--svc-${hash % PALETTE_SIZE})`;
}
