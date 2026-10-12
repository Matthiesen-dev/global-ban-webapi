import { and, eq } from 'drizzle-orm';
import {
    community,
    communityInvite,
    communityJoinRequest,
    communityMember,
    communitySubscription,
    server,
    account,
    user,
} from '../db/schema';
import { getRole, outranks, query, requireRole, type Executor } from './access';
import { Forbidden } from './errors';

const normalizeDiscordId = (id: string) => id.trim();
const DISCORD_ID = /^\d{17,20}$/;

export const listMembers = (actorId: string, communityId: string) =>
    query(async (db) => {
        await requireRole(db, actorId, communityId, 'member');
        return db
            .select({ userId: user.id, name: user.name, role: communityMember.role })
            .from(communityMember)
            .innerJoin(user, eq(user.id, communityMember.userId))
            .where(eq(communityMember.communityId, communityId));
    });

export const removeMember = (actorId: string, communityId: string, targetId: string) =>
    query(async (db) => {
        const actor = await requireRole(db, actorId, communityId, 'member');
        const target = await getRole(db, targetId, communityId);
        if (!target) return;
        if (target === 'owner') throw new Forbidden({ message: 'The owner cannot be removed' });
        // Leaving is always allowed; removing someone else needs a higher rank.
        if (actorId !== targetId && !outranks(actor, target)) {
            throw new Forbidden({ message: 'You do not have permission to do that' });
        }
        await db.transaction(async (tx) => {
            await tx
                .delete(communityMember)
                .where(and(eq(communityMember.communityId, communityId), eq(communityMember.userId, targetId)));
            // Their servers stop syncing with this community immediately.
            await tx
                .update(server)
                .set({ communityId: null })
                .where(and(eq(server.communityId, communityId), eq(server.ownerUserId, targetId)));
        });
    });

export const setRole = (actorId: string, communityId: string, targetId: string, role: 'admin' | 'member') =>
    query(async (db) => {
        await requireRole(db, actorId, communityId, 'owner');
        const target = await getRole(db, targetId, communityId);
        if (!target || target === 'owner') throw new Forbidden({ message: 'You do not have permission to do that' });
        await db
            .update(communityMember)
            .set({ role })
            .where(and(eq(communityMember.communityId, communityId), eq(communityMember.userId, targetId)));
    });

export const inviteMember = (actorId: string, communityId: string, discordId: string, role: 'admin' | 'member') =>
    query(async (db) => {
        const actor = await requireRole(db, actorId, communityId, 'admin');
        if (role === 'admin' && actor !== 'owner') {
            throw new Forbidden({ message: 'Only the owner can invite admins' });
        }
        const id = normalizeDiscordId(discordId);
        if (!DISCORD_ID.test(id)) throw new Forbidden({ message: 'Enter a valid Discord user ID' });
        await db
            .insert(communityInvite)
            .values({ communityId, discordId: id, role, invitedByUserId: actorId, createdAt: new Date() })
            .onConflictDoUpdate({
                target: [communityInvite.communityId, communityInvite.discordId],
                set: { role, invitedByUserId: actorId },
            });
    });

export const listCommunityInvites = (actorId: string, communityId: string) =>
    query(async (db) => {
        await requireRole(db, actorId, communityId, 'admin');
        return db
            .select({ discordId: communityInvite.discordId, role: communityInvite.role })
            .from(communityInvite)
            .where(eq(communityInvite.communityId, communityId));
    });

export const cancelInvite = (actorId: string, communityId: string, discordId: string) =>
    query(async (db) => {
        await requireRole(db, actorId, communityId, 'admin');
        await db
            .delete(communityInvite)
            .where(
                and(eq(communityInvite.communityId, communityId), eq(communityInvite.discordId, normalizeDiscordId(discordId))),
            );
    });

type Account = { id: string };

const findDiscordId = async (db: Executor, userId: string) => {
    const [row] = await db
        .select({ discordId: account.accountId })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, 'discord')));
    return row?.discordId;
};

export const listMyInvites = (me: Account) =>
    query(async (db) => {
        const discordId = await findDiscordId(db, me.id);
        if (!discordId) return [];
        return db
            .select({ communityId: communityInvite.communityId, communityName: community.name, role: communityInvite.role })
            .from(communityInvite)
            .innerJoin(community, eq(community.id, communityInvite.communityId))
            .where(eq(communityInvite.discordId, discordId));
    });

export const respondInvite = (me: Account, communityId: string, accept: boolean) =>
    query(async (db) => {
        const discordId = await findDiscordId(db, me.id);
        if (!discordId) return;
        const [invite] = await db
            .select()
            .from(communityInvite)
            .where(and(eq(communityInvite.communityId, communityId), eq(communityInvite.discordId, discordId)));
        if (!invite) return;
        await db.transaction(async (tx) => {
            await tx
                .delete(communityInvite)
                .where(and(eq(communityInvite.communityId, communityId), eq(communityInvite.discordId, discordId)));
            if (accept) {
                await tx
                    .insert(communityMember)
                    .values({ communityId, userId: me.id, role: invite.role })
                    .onConflictDoNothing();
                await tx
                    .delete(communityJoinRequest)
                    .where(and(eq(communityJoinRequest.communityId, communityId), eq(communityJoinRequest.userId, me.id)));
            }
        });
    });

export const requestJoin = (userId: string, communityId: string) =>
    query(async (db) => {
        // Unknown ids and existing members are silent no-ops so ids cannot be probed.
        const [exists] = await db.select({ id: community.id }).from(community).where(eq(community.id, communityId));
        if (!exists || (await getRole(db, userId, communityId))) return;
        await db
            .insert(communityJoinRequest)
            .values({ communityId, userId, createdAt: new Date() })
            .onConflictDoNothing();
    });

export const listMyRequests = (userId: string) =>
    query((db) =>
        db
            .select({ communityId: communityJoinRequest.communityId })
            .from(communityJoinRequest)
            .where(eq(communityJoinRequest.userId, userId)),
    );

export const cancelRequest = (userId: string, communityId: string) =>
    query(async (db) => {
        await db
            .delete(communityJoinRequest)
            .where(and(eq(communityJoinRequest.communityId, communityId), eq(communityJoinRequest.userId, userId)));
    });

export const listJoinRequests = (actorId: string, communityId: string) =>
    query(async (db) => {
        await requireRole(db, actorId, communityId, 'admin');
        return db
            .select({ userId: user.id, name: user.name })
            .from(communityJoinRequest)
            .innerJoin(user, eq(user.id, communityJoinRequest.userId))
            .where(eq(communityJoinRequest.communityId, communityId));
    });

export const respondJoinRequest = (actorId: string, communityId: string, userId: string, approve: boolean) =>
    query(async (db) => {
        await requireRole(db, actorId, communityId, 'admin');
        await db.transaction(async (tx) => {
            const [req] = await tx
                .select()
                .from(communityJoinRequest)
                .where(and(eq(communityJoinRequest.communityId, communityId), eq(communityJoinRequest.userId, userId)));
            if (!req) return;
            await tx
                .delete(communityJoinRequest)
                .where(and(eq(communityJoinRequest.communityId, communityId), eq(communityJoinRequest.userId, userId)));
            if (approve) {
                await tx
                    .insert(communityMember)
                    .values({ communityId, userId, role: 'member' })
                    .onConflictDoNothing();
            }
        });
    });

export const listSubscriptionRequests = (actorId: string, sourceCommunityId: string) =>
    query(async (db) => {
        await requireRole(db, actorId, sourceCommunityId, 'admin');
        return db
            .select({
                subscriberId: communitySubscription.subscriberCommunityId,
                subscriberName: community.name,
                status: communitySubscription.status,
            })
            .from(communitySubscription)
            .innerJoin(community, eq(community.id, communitySubscription.subscriberCommunityId))
            .where(eq(communitySubscription.sourceCommunityId, sourceCommunityId));
    });

// Source-side admins approve or revoke; denying removes the row.
export const respondSubscription = (actorId: string, sourceCommunityId: string, subscriberId: string, approve: boolean) =>
    query(async (db) => {
        await requireRole(db, actorId, sourceCommunityId, 'admin');
        const match = and(
            eq(communitySubscription.sourceCommunityId, sourceCommunityId),
            eq(communitySubscription.subscriberCommunityId, subscriberId),
        );
        if (approve) await db.update(communitySubscription).set({ status: 'approved' }).where(match);
        else await db.delete(communitySubscription).where(match);
    });

export const cancelSubscription = (actorId: string, subscriberId: string, sourceCommunityId: string) =>
    query(async (db) => {
        await requireRole(db, actorId, subscriberId, 'admin');
        await db
            .delete(communitySubscription)
            .where(
                and(
                    eq(communitySubscription.subscriberCommunityId, subscriberId),
                    eq(communitySubscription.sourceCommunityId, sourceCommunityId),
                ),
            );
    });
