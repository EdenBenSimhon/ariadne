-- Alerting tables + the data-retention function. Hand-written like 0001-0003.

CREATE TABLE IF NOT EXISTS "alert_rules" (
  "tenant_id" varchar(64) NOT NULL,
  "rule_id" varchar(36) NOT NULL,
  "name" varchar(128) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "config" jsonb NOT NULL,
  "webhook_url" varchar(512),
  "last_state" varchar(8) DEFAULT 'ok' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "alert_rules_pk" PRIMARY KEY ("tenant_id", "rule_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alert_events" (
  "tenant_id" varchar(64) NOT NULL,
  "event_id" varchar(36) NOT NULL,
  "rule_id" varchar(36) NOT NULL,
  "rule_name" varchar(128) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "message" varchar(1024) NOT NULL,
  "context" jsonb NOT NULL,
  "fired_at" timestamp with time zone DEFAULT now() NOT NULL,
  "acknowledged" boolean DEFAULT false NOT NULL,
  CONSTRAINT "alert_events_pk" PRIMARY KEY ("tenant_id", "event_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_events_time_idx" ON "alert_events" ("tenant_id", "fired_at");
--> statement-breakpoint

-- Retention: drop span partitions entirely outside the window and delete
-- aged trace/alert rows. SECURITY DEFINER because dropping partitions needs
-- table ownership, which no service role has (B2) — callers get exactly this
-- one maintenance capability and nothing else.
CREATE OR REPLACE FUNCTION eventtracer_retention(keep_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff date := CURRENT_DATE - keep_days;
  part record;
  dropped integer := 0;
BEGIN
  IF keep_days < 7 THEN
    RAISE EXCEPTION 'retention must keep at least 7 days';
  END IF;
  FOR part IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class parent ON parent.oid = i.inhparent
    WHERE parent.relname = 'spans'
      AND c.relname ~ '^spans_p[0-9]{8}$'
      AND to_date(substring(c.relname from 8), 'YYYYMMDD') < cutoff
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I', part.relname);
    dropped := dropped + 1;
  END LOOP;
  DELETE FROM traces WHERE start_time < cutoff::timestamptz;
  DELETE FROM alert_events WHERE fired_at < cutoff::timestamptz;
  RETURN dropped;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'eventtracer_reader') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "alert_rules" TO eventtracer_reader;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "alert_events" TO eventtracer_reader;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'eventtracer_collector') THEN
    REVOKE ALL ON FUNCTION eventtracer_retention(integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION eventtracer_retention(integer) TO eventtracer_collector;
  END IF;
END;
$$;
