import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDatabase, type Database } from '../db/client';
import { account, communitySubscription, server, user } from '../db/schema';
import { Db } from './db';
import { assignServer, createCommunity, listCommunities, registerServer, subscribe } from './dashboard';
import {
    inviteMember,
    listMembers,
    removeMember,
    requestJoin,
    respondInvite,
    respondJoinRequest,
    respondSubscription,
    setRole,
} from './membership';

const SERVER = '11111111-1111-4111-8111-111111111111';

let db: Database;
const run = <A, E>(e: Effect.Effect<A, E, Db>) => Effect.runPromise(e.pipe(Effect.provide(Layer.succeed(Db, db))));
const fails = (e: Effect.Effect<unknown, unknown, Db>) => expect(run(e)).rejects.toBeDefined();
const accountFor = (id: string) => ({ id });
const discordId = (id: string) => ({
    owner: '10000000000000001',
    admin: '10000000000000002',
    member: '10000000000000003',
    outsider: '10000000000000004',
    other: '10000000000000005',
})[id]!;
const roleOf = async (userId: string, communityId: string) =>
    (await run(listMembers('owner', communityId))).find((m) => m.userId === userId)?.role;

let c1: string;

beforeEach(async () => {
    db = makeDatabase('file::memory:');
    await migrate(db, { migrationsFolder: 'drizzle' });
    const now = new Date();
    await db.insert(user).values(
        ['owner', 'admin', 'member', 'outsider', 'other'].map((id) => ({
            id,
            name: id,
            email: `${id}@x.test`,
            createdAt: now,
            updatedAt: now,
        })),
    );
    await db.insert(account).values(
        ['owner', 'admin', 'member', 'outsider', 'other'].map((id) => ({
            id: `discord-${id}`,
            accountId: discordId(id),
            providerId: 'discord',
            userId: id,
            createdAt: now,
            updatedAt: now,
        })),
    );
    await run(createCommunity('owner', 'one'));
    c1 = (await run(listCommunities('owner')))[0]!.id;
    await run(inviteMember('owner', c1, discordId('admin'), 'admin'));
    await run(respondInvite(accountFor('admin'), c1, true));
    await run(inviteMember('admin', c1, discordId('member'), 'member'));
    await run(respondInvite(accountFor('member'), c1, true));
});

describe('membership', () => {
    it('lets invited users join with the invited role', async () => {
        expect(await roleOf('admin', c1)).toBe('admin');
        expect(await roleOf('member', c1)).toBe('member');
    });

    it('blocks non-members and plain members from managing', async () => {
        await fails(inviteMember('outsider', c1, discordId('other'), 'member'));
        await fails(inviteMember('member', c1, discordId('other'), 'member'));
        await fails(listMembers('outsider', c1));
    });

    it('only lets the owner invite admins or change roles', async () => {
        await fails(inviteMember('admin', c1, discordId('other'), 'admin'));
        await fails(setRole('admin', c1, 'member', 'admin'));
        await run(setRole('owner', c1, 'member', 'admin'));
        expect(await roleOf('member', c1)).toBe('admin');
    });

    it('only lets the invited Discord account redeem an invite', async () => {
        await run(inviteMember('owner', c1, discordId('other'), 'member'));
        await run(respondInvite(accountFor('outsider'), c1, true));
        expect(await roleOf('outsider', c1)).toBeUndefined();
        await run(respondInvite(accountFor('other'), c1, true));
        expect(await roleOf('other', c1)).toBe('member');
    });

    it('rejects malformed Discord IDs', async () => {
        await fails(inviteMember('owner', c1, 'not-a-discord-id', 'member'));
    });

    it('needs admin approval for join requests', async () => {
        await run(requestJoin('outsider', c1));
        expect(await roleOf('outsider', c1)).toBeUndefined();
        await fails(respondJoinRequest('member', c1, 'outsider', true));
        await run(respondJoinRequest('admin', c1, 'outsider', true));
        expect(await roleOf('outsider', c1)).toBe('member');
    });

    it('does not let admins remove admins or the owner, but members can leave', async () => {
        await run(setRole('owner', c1, 'member', 'admin'));
        await fails(removeMember('admin', c1, 'member'));
        await fails(removeMember('admin', c1, 'owner'));
        await run(removeMember('member', c1, 'member'));
        expect(await roleOf('member', c1)).toBeUndefined();
    });

    it('detaches a removed member\'s servers from the community', async () => {
        await run(registerServer('member', SERVER, 'srv', c1));
        await run(removeMember('admin', c1, 'member'));
        const [row] = await db.select().from(server).where(eq(server.uuid, SERVER));
        expect(row?.communityId).toBeNull();
    });

    it('stops non-members registering or moving servers into a community', async () => {
        await fails(registerServer('outsider', SERVER, 'srv', c1));
        await run(registerServer('outsider', SERVER, 'srv', null));
        await fails(assignServer('outsider', SERVER, c1));
    });

    it('keeps subscriptions pending until the source community approves', async () => {
        await run(createCommunity('outsider', 'two'));
        const c2 = (await run(listCommunities('outsider')))[0]!.id;
        await run(subscribe('outsider', c2, c1));
        const status = async () => (await db.select().from(communitySubscription))[0]?.status;
        expect(await status()).toBe('pending');
        await fails(respondSubscription('outsider', c1, c2, true));
        await run(respondSubscription('admin', c1, c2, true));
        expect(await status()).toBe('approved');
    });
});
