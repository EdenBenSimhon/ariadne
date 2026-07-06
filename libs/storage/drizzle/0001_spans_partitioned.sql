-- Custom migration: the partitioned spans table (drizzle-kit cannot emit
-- PARTITION BY). Must stay in sync with libs/storage/src/lib/schema/spans.ts.
--
-- Daily range partitions on start_time: retention (TTL) later becomes cheap
-- DROP TABLE of expired partitions. No DEFAULT partition on purpose — the
-- collector rejects spans outside its accepted time window at ingestion, so
-- an out-of-range timestamp can never turn into an INSERT failure loop.
CREATE TABLE "spans" (
	"tenant_id" varchar(64) NOT NULL,
	"span_id" char(16) NOT NULL,
	"trace_id" char(32) NOT NULL,
	"parent_span_id" char(16),
	"service_name" varchar(128) NOT NULL,
	"span_kind" varchar(8) NOT NULL,
	"transport" varchar(16) NOT NULL,
	"channel" varchar(256) NOT NULL,
	"operation_name" varchar(256) NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"status" varchar(8) NOT NULL,
	"error" varchar(1024),
	"metadata" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spans_pk" PRIMARY KEY("tenant_id","span_id","start_time")
) PARTITION BY RANGE ("start_time");
--> statement-breakpoint
CREATE INDEX "spans_trace_idx" ON "spans" USING btree ("tenant_id","trace_id");
--> statement-breakpoint
CREATE INDEX "spans_service_time_idx" ON "spans" USING btree ("tenant_id","service_name","start_time");
--> statement-breakpoint
CREATE INDEX "spans_time_idx" ON "spans" USING btree ("tenant_id","start_time");
--> statement-breakpoint
-- Seam for the deferred partition-maintenance/TTL job: idempotently create
-- the [day, day+1) partition.
CREATE FUNCTION spans_ensure_partition(day date) RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF spans FOR VALUES FROM (%L) TO (%L)',
    'spans_p' || to_char(day, 'YYYYMMDD'),
    day,
    day + 1
  );
END;
$fn$;
--> statement-breakpoint
-- Pre-create partitions for the collector's accepted span-age window plus
-- ~3 months of future days; the maintenance job extends this over time.
DO $$
DECLARE
  d date;
BEGIN
  FOR d IN SELECT generate_series(CURRENT_DATE - 7, CURRENT_DATE + 90, interval '1 day')::date LOOP
    PERFORM spans_ensure_partition(d);
  END LOOP;
END;
$$;
