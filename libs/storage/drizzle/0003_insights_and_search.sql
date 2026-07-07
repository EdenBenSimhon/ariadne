-- Insights (agent/user conclusions about trace data) + log-search indexes.
-- Hand-written like 0001/0002: partitioned-table indexes and extension setup
-- are outside what drizzle-kit can express.

CREATE TABLE IF NOT EXISTS "insights" (
  "tenant_id" varchar(64) NOT NULL,
  "insight_id" varchar(36) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "title" varchar(256) NOT NULL,
  "body" varchar(4000) NOT NULL,
  "trace_ids" jsonb NOT NULL,
  "created_by" varchar(32) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "insights_pk" PRIMARY KEY ("tenant_id", "insight_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insights_time_idx" ON "insights" ("tenant_id", "created_at");
--> statement-breakpoint

-- Metadata key/value search (logger-style filters). GIN on the parent of the
-- partitioned spans table cascades to every partition (PG11+).
CREATE INDEX IF NOT EXISTS "spans_metadata_idx" ON "spans" USING gin ("metadata" jsonb_path_ops);
--> statement-breakpoint

-- Trigram indexes make the free-text ILIKE search (operation/error) usable at
-- scale. pg_trgm is contrib; if this database cannot install extensions the
-- search still works, just unindexed — so failures degrade instead of abort.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE INDEX IF NOT EXISTS "spans_operation_trgm_idx"
      ON "spans" USING gin ("operation_name" gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS "spans_error_trgm_idx"
      ON "spans" USING gin ("error" gin_trgm_ops);
  EXCEPTION WHEN insufficient_privilege OR undefined_file THEN
    RAISE NOTICE 'pg_trgm unavailable — free-text span search stays unindexed';
  END;
END;
$$;
--> statement-breakpoint

-- Insights are the API's one writable table (agent conclusions). The reader
-- role keeps zero write access to trace data; grants are guarded so the
-- migration also applies on databases without the dev roles (like 0002).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'eventtracer_reader') THEN
    GRANT SELECT, INSERT, DELETE ON "insights" TO eventtracer_reader;
  END IF;
END;
$$;
