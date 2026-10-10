import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDatabase, type Database } from '../db/client';
import { community, communityMember, punishment, server, user } from '../db/schema';
import { createCommunity, listCommunities, registerServer } from './dashboard';
import { Db } from './db';
import { inviteMember, listMembers, respondInvite } from './membership';
import {
    cancelTransfer,
    deleteCommunity,
    deleteServer,
    listTransfers,
    respondTransfer,
    transferCommunity,
    transferServer,
} from './ownership';
import { sync } from './sync';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '11111111-1111-4111-8111-222222222222';
const PLAYER = '33333333-3333-4333-8333-333333333333';

let db: Database;
const run = <A, E>(e: Effect.Effect<A, E, Db>) => Effect.runPromise(e.pipe(Effect.provide(Layer.succeed(Db, db))));
const fails = (e: Effect.Effect<unknown, unknown, Db>) => expect(run(e)).rejects.toBeDefined();
const roleOf = async (userId: string, communityId: string) =>
    (await run(listMembers('owner', communityId))).find((m) => m.userId === userId)?.role;
const serverRow = async (uuid: string) => (await db.select().from(server).where(eq(server.uuid, uuid)))[0];

let c1: string;

beforeEach(async () => {
    db = makeDatabase('file::memory:');
    await migrate(db, { migrationsFolder: 'drizzle' });
    const now = new Date();
    await db.insert(user).values(
        ['owner', 'member', 'outsider'].map((id) => ({
            id,
            name: id,
            email: `${id}@x.test`,
            githubLogin: `gh-${id}`,
            createdAt: now,
            updatedAt: now,
        })),
    );
    await run(createCommunity('owner', 'one'));
    c1 = (await run(listCommunities('owner')))[0]!.id;
    await run(inviteMember('owner', c1, 'gh-member', 'member'));
    await run(respondInvite({ id: 'member', githubLogin: 'gh-member' }, c1, true));
});

describe('server ownership', () => {
    it('changes owner only after the recipient accepts', async () => {
        await run(registerServer('owner', S1, 'srv', c1));
        await run(transferServer('owner', S1, '@GH-member'));
        expect((await serverRow(S1))?.ownerUserId).toBe('owner');
        await run(respondTransfer('member', 'server', S1, true));
        const row = await serverRow(S1);
        expect(row?.ownerUserId).toBe('member');
        expect(row?.communityId).toBe(c1);
    });

    it('detaches the server when the new owner is not in its community', async () => {
        await run(registerServer('owner', S1, 'srv', c1));
        await run(transferServer('owner', S1, 'gh-outsider'));
        await run(respondTransfer('outsider', 'server', S1, true));
        const row = await serverRow(S1);
        expect(row?.ownerUserId).toBe('outsider');
        expect(row?.communityId).toBeNull();
    });

    it('lets only the owner offer, only the recipient answer, and the sender cancel', async () => {
        await run(registerServer('owner', S1, 'srv', null));
        await fails(transferServer('member', S1, 'gh-outsider'));
        await run(transferServer('owner', S1, 'gh-member'));
        await run(respondTransfer('outsider', 'server', S1, true));
        expect((await serverRow(S1))?.ownerUserId).toBe('owner');
        expect((await run(listTransfers('owner'))).outgoing).toHaveLength(1);
        await run(cancelTransfer('owner', 'server', S1));
        expect((await run(listTransfers('member'))).incoming).toHaveLength(0);
    });

    it('requires the exact name to delete and keeps its punishments', async () => {
        await run(registerServer('owner', S1, 'srv', c1));
        await run(registerServer('member', S2, 'other', c1));
        await run(
            sync(S1, {
                punishments: [
                    {
                        type: 'ADD',
                        record: {
                            type: 'BAN',
                            timestamp: 1,
                            duration: -1,
                            playerUuid: PLAYER,
                            playerIp: '10.0.0.1',
                            playerDisplayName: 'x',
                            punisherUuid: PLAYER,
                            punisherDisplayName: 'm',
                            reason: 'r',
                            serverUuid: S1,
                        },
                    },
                ],
            }),
        );
        await fails(deleteServer('owner', S1, 'wrong'));
        await fails(deleteServer('member', S1, 'srv'));
        await run(deleteServer('owner', S1, 'srv'));
        expect(await serverRow(S1)).toBeUndefined();
        expect((await db.select().from(punishment))[0]?.originServerUuid).toBeNull();
        const out = await run(sync(S2, { punishments: [] }));
        expect(out.punishments).toHaveLength(1);
        expect(out.punishments[0]?.record.serverUuid).toBe('00000000-0000-0000-0000-000000000000');
    });
});

describe('community ownership', () => {
    it('only transfers to an existing member, who becomes owner while the old owner becomes admin', async () => {
        await fails(transferCommunity('owner', c1, 'gh-outsider'));
        await fails(transferCommunity('member', c1, 'gh-owner'));
        await run(transferCommunity('owner', c1, 'gh-member'));
        await run(respondTransfer('member', 'community', c1, true));
        expect(await roleOf('member', c1)).toBe('owner');
        expect(await roleOf('owner', c1)).toBe('admin');
        expect((await db.select().from(community).where(eq(community.id, c1)))[0]?.ownerUserId).toBe('member');
    });

    it('drops the transfer if the recipient left before accepting', async () => {
        await run(transferCommunity('owner', c1, 'gh-member'));
        await db.delete(communityMember).where(eq(communityMember.userId, 'member'));
        await run(respondTransfer('member', 'community', c1, true));
        expect((await db.select().from(community).where(eq(community.id, c1)))[0]?.ownerUserId).toBe('owner');
    });

    it('deletes a community with its data and detaches servers, owner only', async () => {
        await run(registerServer('member', S1, 'srv', c1));
        await fails(deleteCommunity('member', c1, 'one'));
        await fails(deleteCommunity('owner', c1, 'nope'));
        await run(deleteCommunity('owner', c1, 'one'));
        expect(await db.select().from(community)).toHaveLength(0);
        expect((await serverRow(S1))?.communityId).toBeNull();
    });
});
