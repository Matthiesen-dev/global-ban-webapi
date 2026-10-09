import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { makeDatabase } from './db/client';
import * as schema from './db/schema';

export const auth = betterAuth({
    database: drizzleAdapter(makeDatabase(process.env.DATABASE_URL ?? 'file:local.db', process.env.DATABASE_AUTH_TOKEN), {
        provider: 'sqlite',
        schema,
    }),
    socialProviders: {
        github: {
            clientId: process.env.GITHUB_CLIENT_ID ?? '',
            clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
        },
    },
});
