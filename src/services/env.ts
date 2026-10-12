import { Config, Effect } from 'effect';

export const AppEnv = Config.all({
    DATABASE_URL: Config.NonEmptyString("DATABASE_URL"),
    DATABASE_AUTH_TOKEN: Config.NonEmptyString("DATABASE_AUTH_TOKEN"),
    BETTER_AUTH_URL: Config.NonEmptyString("BETTER_AUTH_URL"),
    DISCORD_CLIENT_ID: Config.NonEmptyString("DISCORD_CLIENT_ID"),
    DISCORD_CLIENT_SECRET: Config.NonEmptyString("DISCORD_CLIENT_SECRET"),
    TRUSTED_PROXIES: Config.String("TRUSTED_PROXIES").pipe(
        Config.withDefault("none")
    ),
    TRUSTED_PROXY_HOPS: Config.Number("TRUSTED_PROXY_HOPS").pipe(
        Config.withDefault(1),
    ),
});

export const getAuthEnv = Effect.gen(function* () {
    const env = yield* AppEnv;
    return {
        BETTER_AUTH_URL: env.BETTER_AUTH_URL,
        DISCORD_CLIENT_ID: env.DISCORD_CLIENT_ID,
        DISCORD_CLIENT_SECRET: env.DISCORD_CLIENT_SECRET,
        DATABASE_URL: env.DATABASE_URL,
        DATABASE_AUTH_TOKEN: env.DATABASE_AUTH_TOKEN,
    };
});

export const getProxyConfig = Effect.gen(function* () {
    const env = yield* AppEnv;
    return {
        mode: env.TRUSTED_PROXIES as 'none' | 'traefik' | 'cloudflare',
        hops: env.TRUSTED_PROXY_HOPS,
    };
});