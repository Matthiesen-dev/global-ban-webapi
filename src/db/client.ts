import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';
import { Effect } from 'effect';
import { AppEnv } from '../services/env';

export type Database = ReturnType<typeof makeDatabase>;

export const makeDatabase = (url: string, authToken?: string) =>
    drizzle(createClient({ url, authToken: authToken || undefined }), { schema });

export const makeDatabaseEffect = Effect.gen(function* () {
    const { DATABASE_URL, DATABASE_AUTH_TOKEN } = yield* AppEnv;
    return drizzle(
        createClient({
            url: DATABASE_URL,
            authToken: DATABASE_AUTH_TOKEN || undefined
        }),
        { schema }
    );
});