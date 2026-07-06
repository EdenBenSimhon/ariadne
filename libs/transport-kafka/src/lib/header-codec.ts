import type { IHeaders } from 'kafkajs';

/**
 * kafkajs delivers header values as Buffer | string | (Buffer|string)[] |
 * undefined; the protocol works with plain string records. Non-scalar and
 * empty values are dropped rather than guessed at.
 */
export function decodeHeaders(headers: IHeaders | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || Array.isArray(value)) continue;
    out[key] = typeof value === 'string' ? value : value.toString('utf8');
  }
  return out;
}

export function encodeHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  return { ...headers };
}
