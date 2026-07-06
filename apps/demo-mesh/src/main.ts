/**
 * Demo mesh — the MVP definition of done (spec §12):
 *
 *   POST /orders → order-service ──kafka──▶ inventory-service ──rabbitmq──▶
 *   payment-service ──rest──▶ order-service
 *
 * One request, one connected trace, three transports — and the business
 * handlers below contain ZERO tracing code. All tracing lives in the
 * transports (headers, spans, fail-safe emission to `_tracing`).
 *
 * Run (after `docker compose up -d`, migrations and the collector):
 *   npx nx serve demo-mesh
 *   curl -s -X POST localhost:4001/orders -H 'content-type: application/json' -d '{"orderId":"ord-42"}'
 * Then open the UI → the new trace spans Kafka, RabbitMQ and REST.
 *
 * All three "services" run in one process purely for demo convenience —
 * each has its own runtime (service name + ALS context + emitter), exactly
 * as if they were separate deployments.
 */
import { tenantIdSchema } from '@ariadne/protocol';
import {
  AsyncLocalStorageContextManager,
  BoundedSpanEmitter,
  DefaultIdGenerator,
  SystemClock,
  type TransportRuntime,
} from '@ariadne/transport-core';
import { KafkaSpanSink, KafkaTransport } from '@ariadne/transport-kafka';
import { RabbitMqTransport } from '@ariadne/transport-rabbitmq';
import { createTracedRestServer, RestTransport } from '@ariadne/transport-rest';

const BROKERS = (process.env['DEMO_KAFKA_BROKERS'] ?? 'localhost:9092').split(',');
const RABBIT_URL = process.env['DEMO_RABBITMQ_URL'] ?? 'amqp://guest:guest@localhost:5672';
const ORDER_PORT = Number(process.env['DEMO_ORDER_PORT'] ?? 4001);
const TENANT = tenantIdSchema.parse(process.env['DEMO_TENANT_ID'] ?? 'acme');

function makeRuntime(serviceName: string): TransportRuntime {
  return {
    serviceName,
    tenantId: TENANT,
    // Fail-safe pipeline: bounded buffer → dedicated tracing producer → _tracing.
    emitter: new BoundedSpanEmitter(
      new KafkaSpanSink({ brokers: BROKERS, clientId: serviceName })
    ),
    // ONE context manager per service: a consumer hop on any transport chains
    // into producer hops on any other transport of the same service.
    context: new AsyncLocalStorageContextManager(),
    clock: new SystemClock(),
    ids: new DefaultIdGenerator(),
    redactionAllowlist: ['orderId', 'amount'],
  };
}

async function main(): Promise<void> {
  // ── order-service: REST in, Kafka out ────────────────────────────────
  const orderRuntime = makeRuntime('order-service');
  const orderKafka = new KafkaTransport(orderRuntime, { brokers: BROKERS });
  const orderServer = createTracedRestServer(orderRuntime, {
    '/orders': async (envelope) => {
      const requested = (envelope.payload as { orderId?: string } | null)?.orderId;
      const orderId = requested ?? `ord-${Math.random().toString(36).slice(2, 8)}`;
      await orderKafka.publish({
        channel: 'orders.created',
        headers: {},
        payload: { orderId, amount: 99 },
        key: orderId,
      });
      return { accepted: true, orderId };
    },
    '/payments/confirm': (envelope) => {
      const { orderId } = envelope.payload as { orderId: string };
      return { confirmed: true, orderId };
    },
  });

  // ── inventory-service: Kafka in, RabbitMQ out ────────────────────────
  const inventoryRuntime = makeRuntime('inventory-service');
  const inventoryKafka = new KafkaTransport(inventoryRuntime, { brokers: BROKERS });
  const inventoryRabbit = new RabbitMqTransport(inventoryRuntime, { url: RABBIT_URL });
  inventoryKafka.subscribe('orders.created', async (envelope) => {
    const { orderId } = envelope.payload as { orderId: string };
    await inventoryRabbit.publish({
      channel: 'inventory.reserved',
      headers: {},
      payload: { orderId },
    });
  });

  // ── payment-service: RabbitMQ in, REST out ───────────────────────────
  const paymentRuntime = makeRuntime('payment-service');
  const paymentRabbit = new RabbitMqTransport(paymentRuntime, { url: RABBIT_URL });
  const paymentRest = new RestTransport(paymentRuntime, {
    baseUrl: `http://localhost:${ORDER_PORT}`,
  });
  paymentRabbit.subscribe('inventory.reserved', async (envelope) => {
    const { orderId } = envelope.payload as { orderId: string };
    await paymentRest.request('/payments/confirm', {
      channel: '/payments/confirm',
      headers: {},
      payload: { orderId },
    });
  });

  await Promise.all([inventoryRabbit.connect(), paymentRabbit.connect()]);
  await Promise.all([orderKafka.connect(), inventoryKafka.connect()]);
  await new Promise<void>((resolve) => orderServer.listen(ORDER_PORT, resolve));

  console.log(`demo mesh up — POST http://localhost:${ORDER_PORT}/orders starts a trace`);
  console.log(
    `try: curl -s -X POST localhost:${ORDER_PORT}/orders -H 'content-type: application/json' -d '{"orderId":"ord-42"}'`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
