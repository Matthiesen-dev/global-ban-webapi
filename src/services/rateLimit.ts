import { Context, Data, Effect, Layer } from 'effect';

export class RateLimited extends Data.TaggedError('RateLimited')<{ readonly retryAfterSeconds: number }> { }

export interface BucketConfig {
    /** Maximum burst size. */
    readonly capacity: number;
    /** Tokens added per second. */
    readonly refillPerSecond: number;
}

const MAX_KEYS = 10_000;

/** In-memory token bucket per key; state is per process, so it resets on restart and is not shared across instances. */
export const makeTokenBuckets = (config: BucketConfig, now: () => number = Date.now) => {
    const buckets = new Map<string, { tokens: number; updatedAt: number }>();
    const refillPerMs = config.refillPerSecond / 1000;

    const refilled = (b: { tokens: number; updatedAt: number }, at: number) =>
        Math.min(config.capacity, b.tokens + (at - b.updatedAt) * refillPerMs);

    const sweep = (at: number) => {
        for (const [key, b] of buckets) if (refilled(b, at) >= config.capacity) buckets.delete(key);
        // Still over the cap means many active keys; drop the oldest rather than grow without bound.
        for (const key of buckets.keys()) {
            if (buckets.size <= MAX_KEYS) break;
            buckets.delete(key);
        }
    };

    return {
        /** Returns 0 when allowed, otherwise the seconds to wait before retrying. */
        consume: (key: string): number => {
            const at = now();
            const existing = buckets.get(key);
            const tokens = existing ? refilled(existing, at) : config.capacity;
            if (tokens >= 1) {
                buckets.delete(key);
                buckets.set(key, { tokens: tokens - 1, updatedAt: at });
                if (buckets.size > MAX_KEYS) sweep(at);
                return 0;
            }
            if (existing) {
                existing.tokens = tokens;
                existing.updatedAt = at;
            }
            return Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000));
        },
        size: () => buckets.size,
    };
};

// The mod's minimum sync interval is one minute, so these leave headroom for retries.
export const IP_LIMIT: BucketConfig = { capacity: 120, refillPerSecond: 2 };
export const SERVER_LIMIT: BucketConfig = { capacity: 10, refillPerSecond: 0.1 };
// IP lookups are the more abusable path (probing who is banned from an address), so they get the tightest bucket.
export const LOOKUP_NAME_LIMIT: BucketConfig = { capacity: 20, refillPerSecond: 0.2 };
export const LOOKUP_IP_LIMIT: BucketConfig = { capacity: 5, refillPerSecond: 0.02 };
export const APPEAL_SUBMIT_LIMIT: BucketConfig = { capacity: 5, refillPerSecond: 0.005 };

export class RateLimiter extends Context.Service<
    RateLimiter,
    {
        readonly checkIp: (ip: string) => Effect.Effect<void, RateLimited>;
        readonly checkServer: (serverUuid: string) => Effect.Effect<void, RateLimited>;
        readonly checkLookupName: (ip: string) => Effect.Effect<void, RateLimited>;
        readonly checkLookupIp: (ip: string) => Effect.Effect<void, RateLimited>;
        readonly checkAppealSubmit: (ip: string) => Effect.Effect<void, RateLimited>;
    }
>()('RateLimiter') { }

export const RateLimiterLive = Layer.sync(RateLimiter, () => {
    const ip = makeTokenBuckets(IP_LIMIT);
    const servers = makeTokenBuckets(SERVER_LIMIT);
    const lookupName = makeTokenBuckets(LOOKUP_NAME_LIMIT);
    const lookupIp = makeTokenBuckets(LOOKUP_IP_LIMIT);
    const submit = makeTokenBuckets(APPEAL_SUBMIT_LIMIT);
    const check = (buckets: ReturnType<typeof makeTokenBuckets>, key: string) =>
        Effect.suspend(() => {
            const wait = buckets.consume(key);
            return wait === 0 ? Effect.void : Effect.fail(new RateLimited({ retryAfterSeconds: wait }));
        });
    return {
        checkIp: (key) => check(ip, key),
        checkServer: (key) => check(servers, key),
        checkLookupName: (key) => check(lookupName, key),
        checkLookupIp: (key) => check(lookupIp, key),
        checkAppealSubmit: (key) => check(submit, key),
    };
});
