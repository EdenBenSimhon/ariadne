import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { spans } from './schema/spans';
import { traces } from './schema/traces';

export const storageSchema = { spans, traces } as const;
export type StorageDb = NodePgDatabase<typeof storageSchema>;

export interface StorageDbOptions {
  readonly url: string;
  /** Encryption in transit (security B2) — on in production, off for local compose. */
  readonly ssl?: boolean;
  readonly maxConnections?: number;
}

export function createStorageDb(options: StorageDbOptions): { db: StorageDb; pool: Pool } {
  const pool = new Pool({
    connectionString: options.url,
    max: options.maxConnections ?? 10,
    ...(options.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  const db = drizzle(pool, { schema: storageSchema });
  return { db, pool };
}
