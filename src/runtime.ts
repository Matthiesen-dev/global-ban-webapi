import { Effect, Layer, ManagedRuntime } from 'effect';
import { DbLive, type Db } from './services/db';
import type { DatabaseError, Forbidden } from './services/errors';
import { RateLimiterLive } from './services/rateLimit';

export const runtime = ManagedRuntime.make(
    Layer.mergeAll(
        DbLive(process.env.DATABASE_URL ?? 'file:local.db', process.env.DATABASE_AUTH_TOKEN),
        RateLimiterLive,
    ),
);

/** Runs a dashboard mutation and returns a user-facing error message, or null on success. */
export const runAction = (effect: Effect.Effect<unknown, DatabaseError | Forbidden, Db>) =>
    runtime.runPromise(
        effect.pipe(
            Effect.as(null as string | null),
            Effect.catchTags({
                Forbidden: (e) => Effect.succeed(e.message),
                DatabaseError: (e) =>
                    Effect.sync(() => {
                        console.error('dashboard action failed', e.cause);
                        return 'Something went wrong';
                    }),
            }),
        ),
    );
