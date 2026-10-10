import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import type { Database } from '../db/client';
import { communitySubscription, punishment, punishmentDelivery, server } from '../db/schema';
import type { PunishmentSync, SyncData } from '../domain/punishment';
import { DatabaseError, ServerNotInCommunity, ServerNotRegistered } from './errors';
import { Db } from './db';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

// Stand-in origin for punishments whose server registration was deleted.
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const naturalKey = (r: PunishmentSync['record'], originServerUuid: string) =>
    and(
        eq(punishment.playerUuid, r.playerUuid),
        eq(punishment.type, r.type),
        eq(punishment.timestamp, r.timestamp),
        eq(punishment.originServerUuid, originServerUuid),
    );

// Records echoed back by the API carry a server's publicId, never its secret uuid.
const resolveOrigin = async (tx: Tx, caller: string, recordServerUuid: string) => {
    if (recordServerUuid === caller) return caller;
    const [byPublic] = await tx.select({ uuid: server.uuid }).from(server).where(eq(server.publicId, recordServerUuid));
    return byPublic?.uuid;
};

const ingest = async (tx: Tx, caller: string, communityId: string, visible: string[], incoming: SyncData, now: Date) => {
    for (const { record, type } of incoming.punishments) {
        if (type === 'ADD') {
            const origin = (await resolveOrigin(tx, caller, record.serverUuid)) ?? caller;
            await tx
                .insert(punishment)
                .values({ id: crypto.randomUUID(), communityId, originServerUuid: origin, ...record, createdAt: now })
                .onConflictDoNothing();
            const [row] = await tx.select({ id: punishment.id }).from(punishment).where(naturalKey(record, origin));
            if (row) {
                await tx
                    .insert(punishmentDelivery)
                    .values({ serverUuid: caller, punishmentId: row.id, syncType: 'ADD', deliveredAt: now })
                    .onConflictDoNothing();
            }
        } else {
            const origin = await resolveOrigin(tx, caller, record.serverUuid);
            if (!origin) continue;
            const [row] = await tx
                .select({ id: punishment.id, communityId: punishment.communityId })
                .from(punishment)
                .where(naturalKey(record, origin));
            if (!row || !visible.includes(row.communityId)) continue;
            await tx.update(punishment).set({ revokedAt: now }).where(eq(punishment.id, row.id));
            await tx
                .insert(punishmentDelivery)
                .values([
                    { serverUuid: caller, punishmentId: row.id, syncType: 'ADD', deliveredAt: now },
                    { serverUuid: caller, punishmentId: row.id, syncType: 'REMOVE', deliveredAt: now },
                ])
                .onConflictDoNothing();
        }
    }
};

const outgoing = async (tx: Tx, caller: string, visible: string[], now: Date): Promise<PunishmentSync[]> => {
    const rows = await tx
        .select({ p: punishment, originPublicId: server.publicId })
        .from(punishment)
        .leftJoin(server, eq(server.uuid, punishment.originServerUuid))
        .where(inArray(punishment.communityId, visible));
    const delivered = await tx.select().from(punishmentDelivery).where(eq(punishmentDelivery.serverUuid, caller));
    const has = new Set(delivered.map((d) => `${d.punishmentId}:${d.syncType}`));

    const result: PunishmentSync[] = [];
    const deliveries: (typeof punishmentDelivery.$inferInsert)[] = [];
    for (const { p, originPublicId } of rows) {
        const record = {
            type: p.type,
            timestamp: p.timestamp,
            duration: p.duration,
            playerUuid: p.playerUuid,
            playerIp: p.playerIp,
            playerDisplayName: p.playerDisplayName,
            punisherUuid: p.punisherUuid,
            punisherDisplayName: p.punisherDisplayName,
            reason: p.reason,
            serverUuid: originPublicId ?? NIL_UUID,
        };
        const hasAdd = has.has(`${p.id}:ADD`);
        if (p.revokedAt === null && !hasAdd) {
            result.push({ record, type: 'ADD' });
            deliveries.push({ serverUuid: caller, punishmentId: p.id, syncType: 'ADD', deliveredAt: now });
        } else if (p.revokedAt !== null && hasAdd && !has.has(`${p.id}:REMOVE`)) {
            result.push({ record, type: 'REMOVE' });
            deliveries.push({ serverUuid: caller, punishmentId: p.id, syncType: 'REMOVE', deliveredAt: now });
        }
    }
    if (deliveries.length > 0) await tx.insert(punishmentDelivery).values(deliveries).onConflictDoNothing();
    return result;
};

export const sync = (serverUuid: string, incoming: SyncData) =>
    Effect.gen(function* () {
        const db = yield* Db;
        const [row] = yield* Effect.tryPromise({
            try: () => db.select().from(server).where(eq(server.uuid, serverUuid)),
            catch: (cause) => new DatabaseError({ cause }),
        });
        if (!row) return yield* Effect.fail(new ServerNotRegistered());
        const communityId = row.communityId;
        if (!communityId) return yield* Effect.fail(new ServerNotInCommunity());

        return yield* Effect.tryPromise({
            try: () =>
                db.transaction(async (tx) => {
                    const now = new Date();
                    const subs = await tx
                        .select({ id: communitySubscription.sourceCommunityId })
                        .from(communitySubscription)
                        .where(
                            and(
                                eq(communitySubscription.subscriberCommunityId, communityId),
                                eq(communitySubscription.status, 'approved'),
                            ),
                        );
                    const visible = [communityId, ...subs.map((s) => s.id)];
                    await tx.update(server).set({ lastSeenAt: now }).where(eq(server.uuid, serverUuid));
                    await ingest(tx, serverUuid, communityId, visible, incoming, now);
                    return { punishments: await outgoing(tx, serverUuid, visible, now) } satisfies SyncData;
                }),
            catch: (cause) => new DatabaseError({ cause }),
        });
    });
