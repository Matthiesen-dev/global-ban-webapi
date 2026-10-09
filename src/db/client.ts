import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

export type Database = ReturnType<typeof makeDatabase>;

export const makeDatabase = (url: string, authToken?: string) =>
    drizzle(createClient({ url, authToken: authToken || undefined }), { schema });
