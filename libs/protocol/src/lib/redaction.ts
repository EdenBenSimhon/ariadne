import { LIMITS } from './constants';
import type { Metadata, MetadataValue } from './schemas/primitives';

/**
 * PII redaction at source (security B1): only allowlisted keys survive, values
 * are coerced to size-capped flat primitives, everything else is dropped.
 * Pure function — every SDK/language port must copy these exact semantics.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function coerceValue(value: unknown): MetadataValue | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return value.length > LIMITS.METADATA_MAX_VALUE_LEN
        ? value.slice(0, LIMITS.METADATA_MAX_VALUE_LEN)
        : value;
    case 'number':
      return Number.isFinite(value) ? value : undefined;
    case 'boolean':
      return value;
    default:
      // Objects, arrays, functions, symbols, bigints: flat primitives only.
      return undefined;
  }
}

export function redactMetadata(
  input: unknown,
  allowlist: readonly string[]
): Metadata | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  if (allowlist.length === 0) return null;

  const allowed = new Set(allowlist);
  const out: Record<string, MetadataValue> = {};
  let kept = 0;

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (kept >= LIMITS.METADATA_MAX_KEYS) break;
    if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) continue;
    if (key.length === 0 || key.length > LIMITS.METADATA_KEY_MAX_LEN) continue;
    const coerced = coerceValue(value);
    if (coerced === undefined) continue;
    out[key] = coerced;
    kept += 1;
  }

  return kept > 0 ? (out as Metadata) : null;
}
