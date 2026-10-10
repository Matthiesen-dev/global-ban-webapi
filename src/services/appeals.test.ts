import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDatabase, type Database } from '../db/client';
import { appeal, community, communityMember, communitySubscription, punishment, server, user } from '../db/schema';
import { classifyTerm, decideAppeal, getCase, lookup, removeOverride, submitAppeal } from './appeals';
import { Db } from './db';
import { sync } from './sync';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PLAYER = '33333333-3333-4333-8333-333333333333';

let db: Database;
const run = <A, E>(effect: Effect.Effect<A, E, Db>) => Effect.runPromise(effect.pipe(Effect.provide(Layer.succeed(Db, db))));

const addPunishment = (id: string, type: 'BAN' | 'IP_BAN' | 'KICK', extra: Partial<typeof punishment.$inferInsert> = {}) =>
    db.insert(punishment).values({
        id,
        communityId: 'c1',
        originServerUuid: A,
        type,
        timestamp: 1000,
        duration: -1,
        playerUuid: PLAYER,
        playerIp: '10.0.0.1',
        playerDisplayName: 'Griefer',
        punisherUuid: PLAYER,
        punisherDisplayName: 'Mod',
        reason: 'grief',
        createdAt: new Date(),
        ...extra,
    });

beforeEach(async () => {
    db = makeDatabase('file::memory:');
    await migrate(db, { migrationsFolder: 'drizzle' });
    const now = new Date();
    await db.insert(user).values([
        { id: 'admin1', name: 'a1', email: 'a1@x', createdAt: now, updatedAt: now },
        { id: 'admin2', name: 'a2', email: 'a2@x', createdAt: now, updatedAt: now },
        { id: 'nobody', name: 'n', email: 'n@x', createdAt: now, updatedAt: now },
    ]);
    await db.insert(community).values([
        { id: 'c1', name: 'origin', ownerUserId: 'admin1', createdAt: now },
        { id: 'c2', name: 'subscriber', ownerUserId: 'admin2', createdAt: now },
    ]);
    await db.insert(communityMember).values([
        { communityId: 'c1', userId: 'admin1', role: 'admin' },
        { communityId: 'c2', userId: 'admin2', role: 'admin' },
    ]);
    await db.insert(communitySubscription).values({ subscriberCommunityId: 'c2', sourceCommunityId: 'c1', status: 'approved' });
    await db.insert(server).values([
        { uuid: A, publicId: 'pub-a', name: 'a', ownerUserId: 'admin1', communityId: 'c1', createdAt: now },
        { uuid: B, publicId: 'pub-b', name: 'b', ownerUserId: 'admin2', communityId: 'c2', createdAt: now },
    ]);
});

describe('classifyTerm', () => {
    it('detects ips and names', () => {
        expect(classifyTerm(' 10.0.0.1 ')).toEqual({ kind: 'ip', value: '10.0.0.1' });
        expect(classifyTerm('::ffff:10.0.0.1')).toEqual({ kind: 'ip', value: '10.0.0.1' });
        expect(classifyTerm('Steve')).toEqual({ kind: 'name', value: 'Steve' });
        expect(classifyTerm('   ')).toBeNull();
    });
});

describe('lookup', () => {
    it('returns only active BAN and IP_BAN rows without leaking ip or punisher', async () => {
        await addPunishment('p1', 'BAN');
        await addPunishment('p2', 'KICK', { timestamp: 2000 });
        await addPunishment('p3', 'IP_BAN', { timestamp: 3000, revokedAt: new Date() });
        await addPunishment('p4', 'BAN', { timestamp: 4000, duration: 10 });
        const found = await run(lookup({ kind: 'name', value: 'griefer' }));
        expect(found.map((f) => f.id)).toEqual(['p1']);
        expect(JSON.stringify(found)).not.toContain('10.0.0.1');
        expect(JSON.stringify(found)).not.toContain('Mod');
        expect(found[0]?.appealTo.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    });

    it('matches by exact ip', async () => {
        await addPunishment('p1', 'IP_BAN');
        expect(await run(lookup({ kind: 'ip', value: '10.0.0.1' }))).toHaveLength(1);
        expect(await run(lookup({ kind: 'ip', value: '10.0.0.2' }))).toHaveLength(0);
    });
});

describe('appeals', () => {
    it('rejects communities that cannot receive the appeal', async () => {
        await addPunishment('p1', 'BAN');
        await db.insert(community).values({ id: 'c3', name: 'other', ownerUserId: 'admin1', createdAt: new Date() });
        await expect(run(submitAppeal([{ punishmentId: 'p1', communityId: 'c3' }], 'please', null))).rejects.toBeDefined();
    });

    it('rejects KICK punishments', async () => {
        await addPunishment('k1', 'KICK');
        await expect(run(submitAppeal([{ punishmentId: 'k1', communityId: 'c1' }], 'please', null))).rejects.toBeDefined();
    });

    it('stores only a token hash and resolves the case by token', async () => {
        await addPunishment('p1', 'BAN');
        const token = await run(
            submitAppeal(
                [
                    { punishmentId: 'p1', communityId: 'c1' },
                    { punishmentId: 'p1', communityId: 'c2' },
                ],
                'sorry',
                'me#1',
            ),
        );
        const stored = await db.select().from(appeal);
        expect(stored.every((a) => a.tokenHash !== token && a.tokenHash.length === 64)).toBe(true);
        const found = await run(getCase(token));
        expect(found).toHaveLength(2);
        expect(found?.[0]?.messages[0]?.body).toBe('sorry');
        expect(await run(getCase('wrong'))).toBeNull();
    });

    it('origin approval revokes globally and records the actor', async () => {
        await addPunishment('p1', 'BAN');
        const token = await run(submitAppeal([{ punishmentId: 'p1', communityId: 'c1' }], 'sorry', null));
        const [c] = (await run(getCase(token)))!;
        await run(decideAppeal('admin1', c!.id, true, 'ok'));
        const [p] = await db.select().from(punishment).where(eq(punishment.id, 'p1'));
        expect(p?.revokedAt).not.toBeNull();
        expect(p?.revokedByUserId).toBe('admin1');
    });

    it('subscriber approval only creates an override that sync honours', async () => {
        await addPunishment('p1', 'BAN');
        const token = await run(submitAppeal([{ punishmentId: 'p1', communityId: 'c2' }], 'sorry', null));
        const [c] = (await run(getCase(token)))!;

        expect((await run(sync(B, { punishments: [] }))).punishments).toHaveLength(1);
        await run(decideAppeal('admin2', c!.id, true, ''));

        const [p] = await db.select().from(punishment).where(eq(punishment.id, 'p1'));
        expect(p?.revokedAt).toBeNull();
        const lifted = (await run(sync(B, { punishments: [] }))).punishments;
        expect(lifted.map((s) => s.type)).toEqual(['REMOVE']);
        expect((await run(sync(A, { punishments: [] }))).punishments.map((s) => s.type)).toEqual(['ADD']);

        await run(removeOverride('admin2', 'c2', 'p1'));
        expect((await run(sync(B, { punishments: [] }))).punishments.map((s) => s.type)).toEqual(['ADD']);
    });

    it('does not let non-admins decide', async () => {
        await addPunishment('p1', 'BAN');
        const token = await run(submitAppeal([{ punishmentId: 'p1', communityId: 'c1' }], 'sorry', null));
        const [c] = (await run(getCase(token)))!;
        await expect(run(decideAppeal('nobody', c!.id, true, ''))).rejects.toBeDefined();
        await expect(run(decideAppeal('admin2', c!.id, true, ''))).rejects.toBeDefined();
    });
});
