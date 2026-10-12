import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { makeDatabase } from './db/client';
import * as schema from './db/schema';
import { DATABASE_URL, DATABASE_AUTH_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } from 'astro:env/server';
import { discordProfileToUser } from './authProfile';

export const auth = betterAuth({
    database: drizzleAdapter(makeDatabase(DATABASE_URL ?? 'file:local.db', DATABASE_AUTH_TOKEN), {
        provider: 'sqlite',
        schema,
    }),
    socialProviders: {
        discord: {
            clientId: DISCORD_CLIENT_ID ?? '',
            clientSecret: DISCORD_CLIENT_SECRET ?? '',
            overrideUserInfoOnSignIn: true,
            mapProfileToUser: discordProfileToUser,
        },
    },
});

export type Auth = typeof auth;
