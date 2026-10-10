import { and, eq, inArray, or } from 'drizzle-orm';
import {
    community,
    communityInvite,
    communityJoinRequest,
    communityMember,
    communitySubscription,
    ownershipTransfer,
    punishment,
    punishmentDelivery,
    server,
    user,
} from '../db/schema';
import { getRole, query, requireRole, type Executor } from './access';
import { Forbidden } from './errors';

const normLogin = (login: string) => login.trim().replace(/^@/, '').toLowerCase();
const denied = () => new Forbidden({ message: 'You do not have permission to do that' });

const findUserByLogin = async (db: Executor, login: string) => {
    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.githubLogin, normLogin(login)));
    if (!row) throw new Forbidden({ message: 'No signed-in user has that GitHub username' });
    return row.id;
};

export const transferServer = (actorId: string, uuid: string, githubLogin: string) =>
    query(async (db) => {
        const [row] = await db.select({ owner: server.ownerUserId }).from(server).where(eq(server.uuid, uuid));
        if (!row || row.owner !== actorId) throw denied();
        const toUserId = await findUserByLogin(db, githubLogin);
        if (toUserId === actorId) throw new Forbidden({ message: 'You already own this server' });
        await db
            .insert(ownershipTransfer)
            .values({ kind: 'server', resourceId: uuid, fromUserId: actorId, toUserId, createdAt: new Date() })
            .onConflictDoUpdate({
                target: [ownershipTransfer.kind, ownershipTransfer.resourceId],
                set: { fromUserId: actorId, toUserId, createdAt: new Date() },
            });
    });

export const transferCommunity = (actorId: string, communityId: string, githubLogin: string) =>
    query(async (db) => {
        await requireRole(db, actorId, communityId, 'owner');
        const toUserId = await findUserByLogin(db, githubLogin);
        if (toUserId === actorId) throw new Forbidden({ message: 'You already own this community' });
        if (!(await getRole(db, toUserId, communityId))) {
            throw new Forbidden({ message: 'The new owner must already be a member of the community' });
        }
        await db
            .insert(ownershipTransfer)
            .values({ kind: 'community', resourceId: communityId, fromUserId: actorId, toUserId, createdAt: new Date() })
            .onConflictDoUpdate({
                target: [ownershipTransfer.kind, ownershipTransfer.resourceId],
                set: { fromUserId: actorId, toUserId, createdAt: new Date() },
            });
    });

export const listTransfers = (userId: string) =>
    query(async (db) => {
        const rows = await db
            .select()
            .from(ownershipTransfer)
            .where(or(eq(ownershipTransfer.toUserId, userId), eq(ownershipTransfer.fromUserId, userId)));
        const serverIds = rows.filter((r) => r.kind === 'server').map((r) => r.resourceId);
        const communityIds = rows.filter((r) => r.kind === 'community').map((r) => r.resourceId);
        const userIds = [...new Set(rows.flatMap((r) => [r.fromUserId, r.toUserId]))];
        const servers = serverIds.length
            ? await db.select({ id: server.uuid, name: server.name }).from(server).where(inArray(server.uuid, serverIds))
            : [];
        const communities = communityIds.length
            ? await db.select({ id: community.id, name: community.name }).from(community).where(inArray(community.id, communityIds))
            : [];
        const users = userIds.length
            ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds))
            : [];
        const names = new Map([...servers, ...communities, ...users].map((n) => [n.id, n.name]));
        const view = (r: (typeof rows)[number]) => ({
            kind: r.kind,
            resourceId: r.resourceId,
            resourceName: names.get(r.resourceId) ?? 'Unknown',
            fromName: names.get(r.fromUserId) ?? 'Unknown',
            toName: names.get(r.toUserId) ?? 'Unknown',
        });
        return {
            incoming: rows.filter((r) => r.toUserId === userId).map(view),
            outgoing: rows.filter((r) => r.fromUserId === userId).map(view),
        };
    });

export const cancelTransfer = (userId: string, kind: 'server' | 'community', resourceId: string) =>
    query(async (db) => {
        await db
            .delete(ownershipTransfer)
            .where(
                and(
                    eq(ownershipTransfer.kind, kind),
                    eq(ownershipTransfer.resourceId, resourceId),
                    eq(ownershipTransfer.fromUserId, userId),
                ),
            );
    });

export const respondTransfer = (userId: string, kind: 'server' | 'community', resourceId: string, accept: boolean) =>
    query(async (db) => {
        const [transfer] = await db
            .select()
            .from(ownershipTransfer)
            .where(
                and(
                    eq(ownershipTransfer.kind, kind),
                    eq(ownershipTransfer.resourceId, resourceId),
                    eq(ownershipTransfer.toUserId, userId),
                ),
            );
        if (!transfer) return;
        await db.transaction(async (tx) => {
            await tx
                .delete(ownershipTransfer)
                .where(and(eq(ownershipTransfer.kind, kind), eq(ownershipTransfer.resourceId, resourceId)));
            if (!accept) return;

            // Re-check at accept time: the sender may have lost ownership since offering.
            if (kind === 'server') {
                const [s] = await tx
                    .select({ owner: server.ownerUserId, communityId: server.communityId })
                    .from(server)
                    .where(eq(server.uuid, resourceId));
                if (!s || s.owner !== transfer.fromUserId) return;
                // A server cannot stay in a community its new owner was never approved for.
                const stays = s.communityId ? (await getRole(tx, userId, s.communityId)) !== null : false;
                await tx
                    .update(server)
                    .set({ ownerUserId: userId, communityId: stays ? s.communityId : null })
                    .where(eq(server.uuid, resourceId));
            } else {
                const [c] = await tx
                    .select({ owner: community.ownerUserId })
                    .from(community)
                    .where(eq(community.id, resourceId));
                if (!c || c.owner !== transfer.fromUserId) return;
                if ((await getRole(tx, userId, resourceId)) === null) return;
                await tx.update(community).set({ ownerUserId: userId }).where(eq(community.id, resourceId));
                await tx
                    .update(communityMember)
                    .set({ role: 'admin' })
                    .where(and(eq(communityMember.communityId, resourceId), eq(communityMember.userId, transfer.fromUserId)));
                await tx
                    .update(communityMember)
                    .set({ role: 'owner' })
                    .where(and(eq(communityMember.communityId, resourceId), eq(communityMember.userId, userId)));
            }
        });
    });

// Confirmation by name guards against stray clicks on an irreversible action.
export const deleteServer = (actorId: string, uuid: string, confirmName: string) =>
    query(async (db) => {
        const [row] = await db
            .select({ owner: server.ownerUserId, name: server.name })
            .from(server)
            .where(eq(server.uuid, uuid));
        if (!row || row.owner !== actorId) throw denied();
        if (row.name !== confirmName) throw new Forbidden({ message: 'Type the server name to confirm deletion' });
        await db.transaction(async (tx) => {
            // Punishments it originated are kept for the community.
            await tx.update(punishment).set({ originServerUuid: null }).where(eq(punishment.originServerUuid, uuid));
            await tx.delete(punishmentDelivery).where(eq(punishmentDelivery.serverUuid, uuid));
            await tx.delete(ownershipTransfer).where(and(eq(ownershipTransfer.kind, 'server'), eq(ownershipTransfer.resourceId, uuid)));
            await tx.delete(server).where(eq(server.uuid, uuid));
        });
    });

export const deleteCommunity = (actorId: string, communityId: string, confirmName: string) =>
    query(async (db) => {
        await requireRole(db, actorId, communityId, 'owner');
        const [row] = await db.select({ name: community.name }).from(community).where(eq(community.id, communityId));
        if (!row) return;
        if (row.name !== confirmName) throw new Forbidden({ message: 'Type the community name to confirm deletion' });
        await db.transaction(async (tx) => {
            const ids = (await tx.select({ id: punishment.id }).from(punishment).where(eq(punishment.communityId, communityId))).map((p) => p.id);
            if (ids.length) await tx.delete(punishmentDelivery).where(inArray(punishmentDelivery.punishmentId, ids));
            await tx.delete(punishment).where(eq(punishment.communityId, communityId));
            await tx
                .delete(communitySubscription)
                .where(
                    or(
                        eq(communitySubscription.subscriberCommunityId, communityId),
                        eq(communitySubscription.sourceCommunityId, communityId),
                    ),
                );
            await tx.delete(communityInvite).where(eq(communityInvite.communityId, communityId));
            await tx.delete(communityJoinRequest).where(eq(communityJoinRequest.communityId, communityId));
            await tx.delete(communityMember).where(eq(communityMember.communityId, communityId));
            await tx.delete(ownershipTransfer).where(and(eq(ownershipTransfer.kind, 'community'), eq(ownershipTransfer.resourceId, communityId)));
            await tx.update(server).set({ communityId: null }).where(eq(server.communityId, communityId));
            await tx.delete(community).where(eq(community.id, communityId));
        });
    });
