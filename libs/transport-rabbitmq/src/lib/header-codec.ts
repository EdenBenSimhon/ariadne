/**
 * amqplib delivers `properties.headers` values as string | Buffer | number |
 * boolean | array | object (AMQP field tables are loosely typed); the protocol
 * works with plain string records. Only string and Buffer values are kept —
 * non-scalar and empty values are dropped rather than guessed at (same policy
 * as the Kafka header codec).
 */
export function decodeHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      out[key] = value;
    } else if (Buffer.isBuffer(value)) {
      out[key] = value.toString('utf8');
    }
  }
  return out;
}

/** Envelope headers are already plain strings — amqplib passes objects through untouched. */
export function encodeHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  return { ...headers };
}
