-- Least-privilege tightening (security B2). The compose init script's
-- ALTER DEFAULT PRIVILEGES granted the collector INSERT+UPDATE+SELECT on all
-- tables; spans are immutable, so revoke UPDATE there. The collector keeps:
--   spans:  INSERT + SELECT (SELECT is required by INSERT ... RETURNING)
--   traces: INSERT + UPDATE + SELECT (the aggregate upsert needs all three)
-- Guarded so the migration also applies on databases without the dev roles.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'eventtracer_collector') THEN
    REVOKE UPDATE ON "spans" FROM eventtracer_collector;
    REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON "spans" FROM eventtracer_collector;
    REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON "traces" FROM eventtracer_collector;
  END IF;
END;
$$;
