import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit diffs ONLY traces.ts — the partitioned spans table is a
 * hand-written custom migration (kit cannot emit PARTITION BY); its schema
 * file is types/queries-only. Paths are repo-root-relative (nx run-commands
 * executes from the workspace root).
 *
 * Migrations run as the DB owner (dev: postgres), never as the collector —
 * least privilege (B2): `npx nx run storage:migrate`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './libs/storage/src/lib/schema/traces.ts',
  out: './libs/storage/drizzle',
  dbCredentials: {
    url:
      process.env['EVENTTRACER_MIGRATOR_URL'] ??
      'postgres://postgres:postgres@localhost:5432/eventtracer',
  },
});
