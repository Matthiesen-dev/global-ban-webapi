import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { makeDatabase } from './db/client';
import * as schema from './db/schema';
import { DATABASE_URL, DATABASE_AUTH_TOKEN, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } from 'astro:env/server';

export const auth = betterAuth({
    database: drizzleAdapter(makeDatabase(DATABASE_URL ?? 'file:local.db', DATABASE_AUTH_TOKEN), {
        provider: 'sqlite',
        schema,
    }),
    user: {
        additionalFields: { githubLogin: { type: 'string', required: false, input: false } },
    },
    socialProviders: {
        github: {
            clientId: GITHUB_CLIENT_ID ?? '',
            clientSecret: GITHUB_CLIENT_SECRET ?? '',
            overrideUserInfoOnSignIn: true,
            mapProfileToUser: (profile) => ({ githubLogin: profile.login.toLowerCase() }),
        },
    },
});

export type Auth = typeof auth;
