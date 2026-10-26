import { and, desc, eq, inArray } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { maskIp } from '../domain/mask';
import { community, communityMember, communitySubscription, punishment, server } from '../db/schema';
import { isExpired, type PunishmentRecord } from '../domain/punishment';
import { query, requireRole } from './access';
import { Forbidden, InvalidPayload } from './errors';
import { VanillaIpBansToPunishment, VanillaPlayerBansToPunishment } from './mc-ban-importers';

export const listServers = (userId: string) =>
    query((db) =>
        db
            .select({
                uuid: server.uuid,
                name: server.name,
                lastSeenAt: server.lastSeenAt,
                communityId: server.communityId,
                communityName: community.name,
            })
            .from(server)
            .leftJoin(community, eq(community.id, server.communityId))
            .where(eq(server.ownerUserId, userId)),
    );

export const registerServer = (userId: string, uuid: string, name: string, communityId: string | null) =>
    query(async (db) => {
        if (communityId) await requireRole(db, userId, communityId, 'member');
        // Same message whether claimed or not, so UUIDs cannot be probed.
        await db
            .insert(server)
            .values({ uuid, publicId: crypto.randomUUID(), name, ownerUserId: userId, communityId, createdAt: new Date() })
            .onConflictDoNothing();
    });

export const assignServer = (userId: string, uuid: string, communityId: string) =>
    query(async (db) => {
        await requireRole(db, userId, communityId, 'member');
        await db.update(server).set({ communityId }).where(and(eq(server.uuid, uuid), eq(server.ownerUserId, userId)));
    });

export const listCommunities = (userId: string) =>
    query(async (db) => {
        const mine = await db
            .select({ id: community.id, name: community.name, role: communityMember.role })
            .from(communityMember)
            .innerJoin(community, eq(community.id, communityMember.communityId))
            .where(eq(communityMember.userId, userId));
        const ids = mine.map((c) => c.id);
        const subs = ids.length
            ? await db.select().from(communitySubscription).where(inArray(communitySubscription.subscriberCommunityId, ids))
            : [];
        return mine.map((c) => ({
            ...c,
            subscriptions: subs
                .filter((s) => s.subscriberCommunityId === c.id)
                .map((s) => ({ id: s.sourceCommunityId, status: s.status })),
        }));
    });

export const createCommunity = (userId: string, name: string) =>
    query(async (db) => {
        const id = crypto.randomUUID();
        await db.insert(community).values({ id, name, ownerUserId: userId, createdAt: new Date() });
        await db.insert(communityMember).values({ communityId: id, userId, role: 'owner' });
    });

export const subscribe = (userId: string, subscriberCommunityId: string, sourceCommunityId: string) =>
    query(async (db) => {
        await requireRole(db, userId, subscriberCommunityId, 'admin');
        if (subscriberCommunityId === sourceCommunityId) return;
        // Unknown ids are a silent no-op so community ids cannot be probed.
        const [source] = await db.select({ id: community.id }).from(community).where(eq(community.id, sourceCommunityId));
        if (!source) return;
        await db.insert(communitySubscription).values({ subscriberCommunityId, sourceCommunityId }).onConflictDoNothing();
    });

export const listPunishments = (userId: string) =>
    query(async (db) => {
        const ids = (await db.select({ id: communityMember.communityId }).from(communityMember).where(eq(communityMember.userId, userId))).map((r) => r.id);
        if (ids.length === 0) return [];
        const rows = await db
            .select({ p: punishment, serverName: server.name, communityName: community.name })
            .from(punishment)
            .leftJoin(server, eq(server.uuid, punishment.originServerUuid))
            .innerJoin(community, eq(community.id, punishment.communityId))
            .where(inArray(punishment.communityId, ids))
            .orderBy(desc(punishment.createdAt))
            .limit(200);
        // Drop the secret server uuid before anything reaches a template.
        return rows.map(({ p, serverName, communityName }) => {
            const { originServerUuid: _omit, ...safe } = p;
            return { ...safe, playerIp: maskIp(safe.playerIp), serverName: serverName ?? 'Deleted server', communityName };
        });
    });

export const revokePunishment = (userId: string, punishmentId: string) =>
    query(async (db) => {
        const [row] = await db.select({ communityId: punishment.communityId }).from(punishment).where(eq(punishment.id, punishmentId));
        if (!row) return;
        await requireRole(db, userId, row.communityId, 'admin');
        await db.update(punishment).set({ revokedAt: new Date(), revokedByUserId: userId }).where(eq(punishment.id, punishmentId));
    });

const decodeBanList = (name: string, text: string | undefined, schema: Schema.Decoder<ReadonlyArray<PunishmentRecord>>) =>
    Effect.gen(function* () {
        if (!text?.trim()) return [];
        const raw = yield* Effect.try({
            try: () => JSON.parse(text) as unknown,
            catch: () => new InvalidPayload({ message: `${name} is not valid JSON` }),
        });
        return yield* Schema.decodeUnknownEffect(schema)(raw).pipe(
            Effect.mapError(() => new InvalidPayload({ message: `${name} is not a valid Minecraft ban list` })),
        );
    });

/** Imports vanilla ban lists into the community of a server the user owns; returns the number of new bans. */
export const importBans = (userId: string, serverUuid: string, playersJson?: string, ipsJson?: string) =>
    Effect.gen(function* () {
        const communityId = yield* query(async (db) => {
            const [row] = await db
                .select({ communityId: server.communityId })
                .from(server)
                .where(and(eq(server.uuid, serverUuid), eq(server.ownerUserId, userId)));
            if (!row?.communityId) throw new Forbidden({ message: 'You do not have permission to do that' });
            await requireRole(db, userId, row.communityId, 'admin');
            return row.communityId;
        });
        const records = [
            ...(yield* decodeBanList('banned_players.json', playersJson, VanillaPlayerBansToPunishment(serverUuid))),
            ...(yield* decodeBanList('banned_ips.json', ipsJson, VanillaIpBansToPunishment(serverUuid))),
        ];
        const now = new Date();
        const live = records.filter((r) => !isExpired(r, now.getTime()));
        return yield* query(async (db) => {
            let imported = 0;
            await db.transaction(async (tx) => {
                for (const r of live) {
                    const res = await tx
                        .insert(punishment)
                        .values({ id: crypto.randomUUID(), communityId, originServerUuid: serverUuid, ...r, createdAt: now })
                        .onConflictDoNothing();
                    imported += res.rowsAffected;
                }
            });
            return imported;
        });
    });
