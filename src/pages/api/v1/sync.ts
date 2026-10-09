import type { APIRoute } from 'astro';
import { Effect, Schema } from 'effect';
import { SyncData, Uuid } from '../../../domain/punishment';
import { runtime } from '../../../runtime';
import { InvalidPayload } from '../../../services/errors';
import { sync } from '../../../services/sync';

export const prerender = false;

const MAX_BODY_BYTES = 1_000_000;

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const handle = (request: Request) =>
    Effect.gen(function* () {
        const serverUuid = yield* Schema.decodeUnknownEffect(Uuid)(request.headers.get('X-Global-Ban-UUID')).pipe(
            Effect.mapError(() => new InvalidPayload({ message: 'Missing or invalid X-Global-Ban-UUID header' })),
        );
        const text = yield* Effect.promise(() => request.text());
        if (text.length > MAX_BODY_BYTES) return yield* Effect.fail(new InvalidPayload({ message: 'Body too large' }));
        const body = yield* Effect.try({
            try: () => JSON.parse(text) as unknown,
            catch: () => new InvalidPayload({ message: 'Body is not valid JSON' }),
        });
        const incoming = yield* Schema.decodeUnknownEffect(SyncData)(body).pipe(
            Effect.mapError(() => new InvalidPayload({ message: 'Body does not match SyncData' })),
        );
        return yield* sync(serverUuid, incoming);
    }).pipe(
        Effect.map((data) => json(data)),
        Effect.catchTags({
            InvalidPayload: (e) => Effect.succeed(json({ error: e.message }, 400)),
            ServerNotRegistered: () => Effect.succeed(json({ error: 'Server not registered' }, 403)),
            ServerNotInCommunity: () => Effect.succeed(json({ error: 'Server is not assigned to a community' }, 403)),
            DatabaseError: (e) =>
                Effect.sync(() => {
                    console.error('sync failed', e.cause);
                    return json({ error: 'Internal error' }, 500);
                }),
        }),
    );

export const POST: APIRoute = ({ request }) => runtime.runPromise(handle(request));
