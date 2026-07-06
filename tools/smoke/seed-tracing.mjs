/**
 * Phase-3 manual smoke seeder — publishes realistic span events to `_tracing`
 * so a running collector can be verified end-to-end.
 *
 *   docker compose up -d
 *   npx nx run storage:migrate
 *   npx nx serve collector          # separate terminal
 *   node tools/smoke/seed-tracing.mjs
 *
 * Emits: 2 traces × the spec §1 six-span chain (shuffled so roots are not
 * first; the second trace contains an ERROR span) + 3 invalid messages
 * (bad JSON, schema-invalid, 1970 timestamp). Expected outcome is documented
 * in docs/IMPLEMENTATION.md.
 *
 * Standalone on purpose: plain kafkajs + node:crypto, no @ariadne imports.
 */
import { randomBytes } from 'node:crypto';
import { Kafka } from 'kafkajs';

const BROKERS = (process.env.COLLECTOR_KAFKA_BROKERS ?? 'localhost:9092').split(',');
const TOPIC = process.env.COLLECTOR_TRACING_TOPIC ?? '_tracing';

const hex = (bytes) => randomBytes(bytes).toString('hex');
const newTraceId = () => hex(16);
const newSpanId = () => hex(8);

/** The spec §1 worked example: one POST /orders → six spans. */
function buildTraceChain({ withError }) {
  const traceId = newTraceId();
  const hops = [
    { serviceName: 'order-service', spanKind: 'PRODUCER', channel: 'orders.created', operationName: 'publish orders.created' },
    { serviceName: 'inventory-service', spanKind: 'CONSUMER', channel: 'orders.created', operationName: 'handleOrderCreated' },
    { serviceName: 'inventory-service', spanKind: 'PRODUCER', channel: 'inventory.reserved', operationName: 'publish inventory.reserved' },
    { serviceName: 'payment-service', spanKind: 'CONSUMER', channel: 'inventory.reserved', operationName: 'handleInventoryReserved' },
    { serviceName: 'payment-service', spanKind: 'PRODUCER', channel: 'payment.completed', operationName: 'publish payment.completed' },
    { serviceName: 'order-service', spanKind: 'CONSUMER', channel: 'payment.completed', operationName: 'handlePaymentCompleted' },
  ];
  const base = Date.now() - 60_000;
  let parentSpanId = null;
  return hops.map((hop, i) => {
    const spanId = newSpanId();
    const failing = withError && i === 4;
    const span = {
      traceId,
      spanId,
      parentSpanId,
      tenantId: 'acme',
      serviceName: hop.serviceName,
      spanKind: hop.spanKind,
      transport: 'kafka',
      channel: hop.channel,
      operationName: hop.operationName,
      startTime: new Date(base + i * 50).toISOString(),
      durationMs: 20 + i * 10,
      status: failing ? 'ERROR' : 'OK',
      error: failing ? 'Error: card declined' : null,
      metadata: { orderId: `ord-${traceId.slice(0, 6)}` },
    };
    parentSpanId = spanId;
    return span;
  });
}

function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function main() {
  const kafka = new Kafka({ clientId: 'eventtracer-smoke-seed', brokers: BROKERS });

  const admin = kafka.admin();
  await admin.connect();
  await admin
    .createTopics({ topics: [{ topic: TOPIC, numPartitions: 3 }], waitForLeaders: true })
    .catch(() => undefined); // exists already — fine
  await admin.disconnect();

  const spans = shuffle([
    ...buildTraceChain({ withError: false }),
    ...buildTraceChain({ withError: true }),
  ]);

  const invalid = [
    { value: 'this is not json {' },
    { value: JSON.stringify({ hello: 'world' }) },
    {
      value: JSON.stringify({
        ...buildTraceChain({ withError: false })[0],
        startTime: '1970-01-01T00:00:00.000Z',
      }),
    },
  ];

  const producer = kafka.producer();
  await producer.connect();
  await producer.send({
    topic: TOPIC,
    messages: [
      ...spans.map((span) => ({ key: span.traceId, value: JSON.stringify(span) })),
      ...invalid,
    ],
  });
  await producer.disconnect();

  console.log(`seeded ${spans.length} valid spans (2 traces) + ${invalid.length} invalid messages to '${TOPIC}'`);
  console.log('expect: traces=2 rows (span_count=6, root_service=order-service, one has_error=t), spans=12, /healthz spansInvalid>=3');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
