-- Least-privilege roles (security B2). Runs once on first container start.
-- Migrations run as the owner (postgres in dev); services connect with these:
--   eventtracer_collector  — INSERT/UPDATE/SELECT (upserts need all three; no DELETE, no DDL)
--   eventtracer_reader     — SELECT only (Phase 4 API)
-- Dev passwords only; production uses a secret manager (security B5).

CREATE ROLE eventtracer_collector LOGIN PASSWORD 'collector_dev';
CREATE ROLE eventtracer_reader LOGIN PASSWORD 'reader_dev';

GRANT CONNECT ON DATABASE eventtracer TO eventtracer_collector, eventtracer_reader;

\connect eventtracer

GRANT USAGE ON SCHEMA public TO eventtracer_collector, eventtracer_reader;

-- Apply to tables created later by migrations (run as postgres).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT INSERT, UPDATE, SELECT ON TABLES TO eventtracer_collector;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON TABLES TO eventtracer_reader;
