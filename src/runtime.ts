import { Effect, Layer, ManagedRuntime } from 'effect';
import { resolveClientIp } from './services/clientIp';
import { getProxyConfig } from './services/env';
import { DbLive, type Db } from './services/db';
import type { DatabaseError, Forbidden, InvalidPayload } from './services/errors';
import { RateLimiterLive, type RateLimited, type RateLimiter } from './services/rateLimit';

export const runtime = ManagedRuntime.make(
    Layer.mergeAll(
        DbLive,
        RateLimiterLive,
    ),
);

/** Runs a dashboard mutation and returns a user-facing error message, or null on success. */
export const runAction = (effect: Effect.Effect<unknown, DatabaseError | Forbidden | InvalidPayload, Db>) =>
    runtime.runPromise(
        effect.pipe(
            Effect.as(null as string | null),
            Effect.catchTags({
                Forbidden: (e) => Effect.succeed(e.message),
                InvalidPayload: (e) => Effect.succeed(e.message),
                DatabaseError: (e) =>
                    Effect.sync(() => {
                        console.error('dashboard action failed', e.cause);
                        return 'Something went wrong';
                    }),
            }),
        ),
    );

export type Outcome<A> = { ok: true; value: A } | { ok: false; error: string };

/** Runs a public (unauthenticated) effect, turning expected failures into user-facing messages. */
export const runPublic = <A>(effect: Effect.Effect<A, DatabaseError | Forbidden | RateLimited, Db | RateLimiter>) =>
    runtime.runPromise(
        effect.pipe(
            Effect.map((value): Outcome<A> => ({ ok: true, value })),
            Effect.catchTags({
                Forbidden: (e) => Effect.succeed<Outcome<A>>({ ok: false, error: e.message }),
                RateLimited: (e) =>
                    Effect.succeed<Outcome<A>>({ ok: false, error: `Too many requests, try again in ${e.retryAfterSeconds} seconds` }),
                DatabaseError: (e) =>
                    Effect.sync((): Outcome<A> => {
                        console.error('public action failed', e.cause);
                        return { ok: false, error: 'Something went wrong' };
                    }),
            }),
        ),
    );

export const proxyConfigFromEnv = () => runtime.runPromise(getProxyConfig);

const proxyConfig = await proxyConfigFromEnv();

export const clientIpOf = (request: Request, getClientAddress: () => string) => {
    let socketIp = 'unknown';
    try {
        socketIp = getClientAddress();
    } catch {
        // Shared bucket rather than skipping limiting.
    }
    return resolveClientIp(proxyConfig, request.headers, socketIp);
};
