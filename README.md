# ariadne
Transport-agnostic distributed tracing for event-driven and API-based systems — one trace across Kafka, RabbitMQ, and REST, with zero tracing code in your services.

See `docs/IMPLEMENTATION.md` for what is built so far and `CLAUDE.md` for project rules.

## Local dev (Phase 3+)

```bash
nvm use 22
docker compose up -d              # Kafka (KRaft) + Postgres 16 + least-privilege roles
npx nx run storage:migrate        # apply migrations as the dev owner
npx nx serve collector            # consumes _tracing → Postgres; health at :3001/healthz

# seed a demo workload and verify end-to-end
node tools/smoke/seed-tracing.mjs
docker compose exec postgres psql -U eventtracer_reader -d eventtracer \
  -c "SELECT trace_id, root_service, span_count, has_error, duration_ms FROM traces ORDER BY start_time"
```

## Workspace

```bash
npx nx run-many -t lint,test,build --all    # the full gate
npx nx graph                                # project dependency graph
```
