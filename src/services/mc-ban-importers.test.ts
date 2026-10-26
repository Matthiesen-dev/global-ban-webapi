import { migrate } from 'drizzle-orm/libsql/migrator';
import { Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDatabase, type Database } from '../db/client';
import { community, communityMember, punishment, server, user } from '../db/schema';
import { Db } from './db';
import { importBans } from './dashboard';

const S = '11111111-1111-4111-8111-111111111111';
const NOCOMM = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const PLAYER = '44444444-4444-4444-8444-444444444444';

const players = JSON.stringify([
    { uuid: PLAYER, name: 'Griefer', created: '2024-01-01 12:00:00 +0000', source: 'Admin', expires: 'forever', reason: 'grief' },
    { uuid: OTHER, name: 'Temp', created: '2024-01-01 12:00:00 +0000', source: 'Admin', expires: '2024-01-02 12:00:00 +0000', reason: 'old' },
]);
const ips = JSON.stringify([
    { ip: '10.0.0.1', created: '2024-01-01 12:00:00 +0000', source: 'Admin', expires: 'forever', reason: 'bot' },
]);

let db: Database;
const run = (userId: string, serverUuid: string, p?: string, i?: string) =>
    Effect.runPromise(importBans(userId, serverUuid, p, i).pipe(Effect.provide(Layer.succeed(Db, db))));

beforeEach(async () => {
    db = makeDatabase('file::memory:');
    await migrate(db, { migrationsFolder: 'drizzle' });
    const now = new Date();
    await db.insert(user).values([
        { id: 'u', name: 'u', email: 'u@x', createdAt: now, updatedAt: now },
        { id: 'm', name: 'm', email: 'm@x', createdAt: now, updatedAt: now },
    ]);
    await db.insert(community).values({ id: 'c1', name: 'one', ownerUserId: 'u', createdAt: now });
    await db.insert(communityMember).values([
        { communityId: 'c1', userId: 'u', role: 'admin' },
        { communityId: 'c1', userId: 'm', role: 'member' },
    ]);
    await db.insert(server).values([
        { uuid: S, publicId: 'pub-s', name: 's', ownerUserId: 'u', communityId: 'c1', createdAt: now },
        { uuid: NOCOMM, publicId: 'pub-n', name: 'n', ownerUserId: 'u', communityId: null, createdAt: now },
    ]);
});

describe('importBans', () => {
    it('imports non-expired bans once and is idempotent', async () => {
        expect(await run('u', S, players, ips)).toBe(2);
        const rows = await db.select().from(punishment);
        expect(rows.map((r) => r.type).sort()).toEqual(['BAN', 'IP_BAN']);
        expect(rows.every((r) => r.duration === -1 && r.communityId === 'c1' && r.originServerUuid === S)).toBe(true);
        expect(await run('u', S, players, ips)).toBe(0);
    });

    it('rejects invalid input', async () => {
        await expect(run('u', S, 'nope')).rejects.toMatchObject({ _tag: 'InvalidPayload' });
        await expect(run('u', S, JSON.stringify([{ uuid: 'bad' }]))).rejects.toMatchObject({ _tag: 'InvalidPayload' });
    });

    it('rejects servers the user cannot import into', async () => {
        await expect(run('u', NOCOMM, players)).rejects.toMatchObject({ _tag: 'Forbidden' });
        await expect(run('m', S, players)).rejects.toMatchObject({ _tag: 'Forbidden' });
        await expect(run('m', NOCOMM, players)).rejects.toMatchObject({ _tag: 'Forbidden' });
    });
});
