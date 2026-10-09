import { migrate } from 'drizzle-orm/libsql/migrator';
import { Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDatabase, type Database } from '../db/client';
import { community, communitySubscription, server, user } from '../db/schema';
import type { PunishmentSync } from '../domain/punishment';
import { Db } from './db';
import { sync } from './sync';

const A = '11111111-1111-4111-8111-111111111111';
const A2 = '11111111-1111-4111-8111-222222222222';
const B = '22222222-2222-4222-8222-222222222222';
const PLAYER = '33333333-3333-4333-8333-333333333333';

const ban = (serverUuid: string, type: PunishmentSync['type'] = 'ADD'): PunishmentSync => ({
    type,
    record: {
        type: 'BAN',
        timestamp: 1000,
        duration: -1,
        playerUuid: PLAYER,
        playerIp: '10.0.0.1',
        playerDisplayName: 'Griefer',
        punisherUuid: PLAYER,
        punisherDisplayName: 'Mod',
        reason: 'grief',
        serverUuid,
    },
});

let db: Database;
const run = (uuid: string, punishments: PunishmentSync[] = []) =>
    Effect.runPromise(sync(uuid, { punishments }).pipe(Effect.provide(Layer.succeed(Db, db))));

beforeEach(async () => {
    db = makeDatabase('file::memory:');
    await migrate(db, { migrationsFolder: 'drizzle' });
    const now = new Date();
    await db.insert(user).values({ id: 'u', name: 'u', email: 'u@x', createdAt: now, updatedAt: now });
    await db.insert(community).values([
        { id: 'c1', name: 'one', ownerUserId: 'u', createdAt: now },
        { id: 'c2', name: 'two', ownerUserId: 'u', createdAt: now },
    ]);
    await db.insert(server).values([
        { uuid: A, publicId: 'pub-a', name: 'a', ownerUserId: 'u', communityId: 'c1', createdAt: now },
        { uuid: A2, publicId: 'pub-a2', name: 'a2', ownerUserId: 'u', communityId: 'c1', createdAt: now },
        { uuid: B, publicId: 'pub-b', name: 'b', ownerUserId: 'u', communityId: 'c2', createdAt: now },
    ]);
});

describe('sync', () => {
    it('rejects unregistered servers', async () => {
        await expect(run('99999999-9999-4999-8999-999999999999')).rejects.toBeDefined();
    });

    it('shares a punishment inside a community without leaking the server uuid', async () => {
        expect((await run(A, [ban(A)])).punishments).toEqual([]);
        const out = (await run(A2)).punishments;
        expect(out).toHaveLength(1);
        expect(out[0]?.type).toBe('ADD');
        expect(out[0]?.record.serverUuid).toBe('pub-a');
        expect((await run(A2)).punishments).toEqual([]);
    });

    it('is idempotent when the same punishment is re-sent', async () => {
        await run(A, [ban(A)]);
        await run(A, [ban(A)]);
        expect((await run(A2)).punishments).toHaveLength(1);
    });

    it('does not cross communities without a subscription', async () => {
        await run(A, [ban(A)]);
        expect((await run(B)).punishments).toEqual([]);
    });

    it('delivers across communities with a subscription', async () => {
        await run(A, [ban(A)]);
        await db
            .insert(communitySubscription)
            .values({ subscriberCommunityId: 'c2', sourceCommunityId: 'c1', status: 'approved' });
        expect((await run(B)).punishments).toHaveLength(1);
    });

    it('ignores pending subscriptions', async () => {
        await run(A, [ban(A)]);
        await db.insert(communitySubscription).values({ subscriberCommunityId: 'c2', sourceCommunityId: 'c1' });
        expect((await run(B)).punishments).toEqual([]);
    });

    it('propagates REMOVE only to servers that received the ADD', async () => {
        await run(A, [ban(A)]);
        await run(A2);
        const removal = ban('pub-a', 'REMOVE');
        expect((await run(A, [removal])).punishments).toEqual([]);
        const out = (await run(A2)).punishments;
        expect(out).toHaveLength(1);
        expect(out[0]?.type).toBe('REMOVE');
    });
});
