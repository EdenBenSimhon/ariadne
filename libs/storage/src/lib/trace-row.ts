import type { InferSelectModel } from 'drizzle-orm';
import { traces } from './schema/traces';

export type StoredTrace = InferSelectModel<typeof traces>;
