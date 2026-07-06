import {
  SPAN_ID_REGEX,
  TRACE_ID_REGEX,
  type SpanId,
  type TraceId,
} from './schemas/primitives';

/**
 * Id generation uses globalThis.crypto (Web Crypto) — available in Node 22 and
 * every evergreen browser — so this module stays isomorphic with no `node:*`
 * imports.
 */
function randomHex(byteLength: number): string {
  const buf = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(buf);
  let out = '';
  for (const byte of buf) out += byte.toString(16).padStart(2, '0');
  return out;
}

function isAllZero(hex: string): boolean {
  for (const ch of hex) if (ch !== '0') return false;
  return true;
}

/** 16 random bytes as 32 lowercase hex chars. Never all-zero (W3C requirement). */
export function newTraceId(): TraceId {
  let hex = randomHex(16);
  while (isAllZero(hex)) hex = randomHex(16);
  return hex as TraceId;
}

/** 8 random bytes as 16 lowercase hex chars. Never all-zero (W3C requirement). */
export function newSpanId(): SpanId {
  let hex = randomHex(8);
  while (isAllZero(hex)) hex = randomHex(8);
  return hex as SpanId;
}

/** Correlation ids pair a request with its reply (spec §3); span-id format. */
export function newCorrelationId(): string {
  return randomHex(8);
}

export function isTraceId(value: string): value is TraceId {
  return TRACE_ID_REGEX.test(value) && !isAllZero(value);
}

export function isSpanId(value: string): value is SpanId {
  return SPAN_ID_REGEX.test(value) && !isAllZero(value);
}
