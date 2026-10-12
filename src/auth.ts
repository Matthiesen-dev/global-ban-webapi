import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { makeDatabase } from './db/client';
import * as schema from './db/schema';
import { discordProfileToUser } from './authProfile';
import { getAuthEnv } from './services/env';
import { runtime } from './runtime';

const env = await runtime.runPromise(getAuthEnv);

export const auth = betterAuth({
    database: drizzleAdapter(makeDatabase(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN), {
        provider: 'sqlite',
        schema,
    }),
    baseURL: env.BETTER_AUTH_URL,
    socialProviders: {
        discord: {
            clientId: env.DISCORD_CLIENT_ID,
            clientSecret: env.DISCORD_CLIENT_SECRET,
            overrideUserInfoOnSignIn: true,
            mapProfileToUser: discordProfileToUser,
        },
    },
});

export type Auth = typeof auth;
