import { isIP } from 'node:net';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import type { Database } from '../db/client';
import { maskIp } from '../domain/mask';
import { APPEALABLE_TYPES, isActive } from '../domain/punishment';
import {
    appeal,
    appealMessage,
    community,
    communityMember,
    communitySubscription,
    punishment,
    punishmentDelivery,
    punishmentOverride,
    server,
} from '../db/schema';
import { query, requireRole } from './access';
import { Forbidden } from './errors';
import { RateLimiter } from './rateLimit';

const MAX_MESSAGE = 2000;
const MAX_CONTACT = 200;
const MAX_ITEMS = 20;
const MAX_RESULTS = 50;

const sha256 = async (value: string) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

const newToken = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const invalid = (message: string) => new Forbidden({ message });

export type LookupTerm = { kind: 'ip' | 'name'; value: string };

export const classifyTerm = (raw: string): LookupTerm | null => {
    const term = raw.trim();
    if (term.length === 0 || term.length > 64) return null;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(term);
    const ip = mapped?.[1] ?? term;
    return isIP(ip) ? { kind: 'ip', value: ip } : { kind: 'name', value: term };
};

/** Communities that may decide an appeal: the community holding the ban plus its approved subscribers. */
const eligibleCommunities = async (db: Database, punishmentIds: string[]) => {
    const rows = await db
        .select({ id: punishment.id, communityId: punishment.communityId })
        .from(punishment)
        .where(inArray(punishment.id, punishmentIds));
    const sources = [...new Set(rows.map((r) => r.communityId))];
    const subs = sources.length
        ? await db
            .select()
            .from(communitySubscription)
            .where(and(inArray(communitySubscription.sourceCommunityId, sources), eq(communitySubscription.status, 'approved')))
        : [];
    const overrides = punishmentIds.length
        ? await db.select().from(punishmentOverride).where(inArray(punishmentOverride.punishmentId, punishmentIds))
        : [];
    const existing = punishmentIds.length
        ? await db.select().from(appeal).where(inArray(appeal.punishmentId, punishmentIds))
        : [];
    const names = new Map((await db.select({ id: community.id, name: community.name }).from(community)).map((c) => [c.id, c.name]));

    const result = new Map<string, { id: string; name: string }[]>();
    for (const r of rows) {
        const candidates = [r.communityId, ...subs.filter((s) => s.sourceCommunityId === r.communityId).map((s) => s.subscriberCommunityId)];
        result.set(
            r.id,
            candidates
                .filter((c) => !overrides.some((o) => o.punishmentId === r.id && o.communityId === c))
                .filter((c) => !existing.some((a) => a.punishmentId === r.id && a.communityId === c && a.status !== 'withdrawn'))
                .map((c) => ({ id: c, name: names.get(c) ?? 'Unknown' })),
        );
    }
    return result;
};

/** Active bans matching the term. Never exposes the IP, punisher or origin server. */
export const lookup = (term: LookupTerm) =>
    query(async (db) => {
        const rows = await db
            .select({ p: punishment, communityName: community.name })
            .from(punishment)
            .innerJoin(community, eq(community.id, punishment.communityId))
            .where(
                and(
                    inArray(punishment.type, [...APPEALABLE_TYPES]),
                    term.kind === 'ip'
                        ? eq(punishment.playerIp, term.value)
                        : sql`lower(${punishment.playerDisplayName}) = lower(${term.value})`,
                ),
            )
            .orderBy(desc(punishment.timestamp))
            .limit(MAX_RESULTS * 2);
        const now = Date.now();
        const active = rows.filter(({ p }) => isActive(p, now)).slice(0, MAX_RESULTS);
        const eligible = await eligibleCommunities(db, active.map(({ p }) => p.id));
        return active.map(({ p, communityName }) => ({
            id: p.id,
            type: p.type,
            timestamp: p.timestamp,
            reason: p.reason,
            communityName,
            appealTo: eligible.get(p.id) ?? [],
        }));
    });

export const lookupLimited = (clientIp: string, raw: string) =>
    Effect.gen(function* () {
        const term = classifyTerm(raw);
        if (!term) return yield* Effect.fail(invalid('Enter a player name or IP address'));
        const limiter = yield* RateLimiter;
        yield* term.kind === 'ip' ? limiter.checkLookupIp(clientIp) : limiter.checkLookupName(clientIp);
        return yield* lookup(term);
    });

export interface AppealTarget {
    readonly punishmentId: string;
    readonly communityId: string;
}

/** Creates one appeal per target under a shared case token, which is returned once and never stored in plain. */
export const submitAppeal = (targets: readonly AppealTarget[], message: string, contact: string | null) =>
    query(async (db) => {
        const body = message.trim();
        const reach = contact?.trim() || null;
        if (targets.length === 0 || targets.length > MAX_ITEMS) throw invalid('Select at least one ban to appeal');
        if (body.length === 0 || body.length > MAX_MESSAGE) throw invalid(`Message must be 1-${MAX_MESSAGE} characters`);
        if (reach && reach.length > MAX_CONTACT) throw invalid(`Contact must be at most ${MAX_CONTACT} characters`);

        const ids = [...new Set(targets.map((t) => t.punishmentId))];
        const bans = await db.select().from(punishment).where(inArray(punishment.id, ids));
        const now = Date.now();
        const live = new Map(
            bans.filter((p) => (APPEALABLE_TYPES as readonly string[]).includes(p.type) && isActive(p, now)).map((p) => [p.id, p]),
        );
        const eligible = await eligibleCommunities(db, ids);
        const unique = [...new Map(targets.map((t) => [`${t.punishmentId}:${t.communityId}`, t])).values()];
        for (const t of unique) {
            if (!live.has(t.punishmentId) || !eligible.get(t.punishmentId)?.some((c) => c.id === t.communityId)) {
                throw invalid('One or more selected bans cannot be appealed');
            }
        }

        const token = newToken();
        const tokenHash = await sha256(token);
        const caseId = crypto.randomUUID();
        const created = new Date();
        await db.transaction(async (tx) => {
            for (const t of unique) {
                // A withdrawn appeal frees the slot; eligibility above already excluded every other status.
                await tx
                    .delete(appeal)
                    .where(and(eq(appeal.punishmentId, t.punishmentId), eq(appeal.communityId, t.communityId), eq(appeal.status, 'withdrawn')));
                const id = crypto.randomUUID();
                await tx.insert(appeal).values({
                    id,
                    caseId,
                    tokenHash,
                    punishmentId: t.punishmentId,
                    communityId: t.communityId,
                    contact: reach,
                    createdAt: created,
                });
                await tx.insert(appealMessage).values({ id: crypto.randomUUID(), appealId: id, author: 'player', body, createdAt: created });
            }
        });
        return token;
    });

export const submitAppealLimited = (clientIp: string, targets: readonly AppealTarget[], message: string, contact: string | null) =>
    Effect.gen(function* () {
        yield* (yield* RateLimiter).checkAppealSubmit(clientIp);
        return yield* submitAppeal(targets, message, contact);
    });

export const getCase = (token: string) =>
    query(async (db) => {
        const tokenHash = await sha256(token);
        const rows = await db
            .select({ a: appeal, p: punishment, communityName: community.name })
            .from(appeal)
            .innerJoin(punishment, eq(punishment.id, appeal.punishmentId))
            .innerJoin(community, eq(community.id, appeal.communityId))
            .where(eq(appeal.tokenHash, tokenHash))
            .orderBy(asc(community.name));
        if (rows.length === 0) return null;
        const messages = await db
            .select()
            .from(appealMessage)
            .where(inArray(appealMessage.appealId, rows.map((r) => r.a.id)))
            .orderBy(asc(appealMessage.createdAt));
        return rows.map(({ a, p, communityName }) => ({
            id: a.id,
            status: a.status,
            communityName,
            type: p.type,
            reason: p.reason,
            decisionNote: a.decisionNote,
            createdAt: a.createdAt,
            decidedAt: a.decidedAt,
            messages: messages.filter((m) => m.appealId === a.id).map((m) => ({ author: m.author, body: m.body, createdAt: m.createdAt })),
        }));
    });

const ownedByToken = async (db: Database, token: string, appealId: string) => {
    const [row] = await db
        .select()
        .from(appeal)
        .where(and(eq(appeal.id, appealId), eq(appeal.tokenHash, await sha256(token))));
    return row;
};

export const addPlayerMessage = (token: string, appealId: string, message: string) =>
    query(async (db) => {
        const body = message.trim();
        if (body.length === 0 || body.length > MAX_MESSAGE) throw invalid(`Message must be 1-${MAX_MESSAGE} characters`);
        const row = await ownedByToken(db, token, appealId);
        if (!row || row.status !== 'pending') return;
        await db.insert(appealMessage).values({ id: crypto.randomUUID(), appealId, author: 'player', body, createdAt: new Date() });
    });

export const withdrawAppeal = (token: string, appealId: string) =>
    query(async (db) => {
        const row = await ownedByToken(db, token, appealId);
        if (!row || row.status !== 'pending') return;
        await db.update(appeal).set({ status: 'withdrawn', decidedAt: new Date() }).where(eq(appeal.id, appealId));
    });

export const listAppeals = (userId: string) =>
    query(async (db) => {
        const ids = (
            await db
                .select({ id: communityMember.communityId })
                .from(communityMember)
                .where(and(eq(communityMember.userId, userId), inArray(communityMember.role, ['admin', 'owner'])))
        ).map((r) => r.id);
        if (ids.length === 0) return [];
        const rows = await db
            .select({ a: appeal, p: punishment, communityName: community.name, originCommunityId: punishment.communityId })
            .from(appeal)
            .innerJoin(punishment, eq(punishment.id, appeal.punishmentId))
            .innerJoin(community, eq(community.id, appeal.communityId))
            .where(inArray(appeal.communityId, ids))
            .orderBy(desc(appeal.createdAt))
            .limit(200);
        const messages = rows.length
            ? await db
                .select()
                .from(appealMessage)
                .where(inArray(appealMessage.appealId, rows.map((r) => r.a.id)))
                .orderBy(asc(appealMessage.createdAt))
            : [];
        return rows.map(({ a, p, communityName }) => ({
            id: a.id,
            status: a.status,
            communityId: a.communityId,
            communityName,
            // Approving here revokes the ban everywhere only when this community issued it.
            isOrigin: p.communityId === a.communityId,
            type: p.type,
            playerName: p.playerDisplayName,
            playerIp: maskIp(p.playerIp),
            reason: p.reason,
            contact: a.contact,
            decisionNote: a.decisionNote,
            createdAt: a.createdAt,
            messages: messages.filter((m) => m.appealId === a.id).map((m) => ({ author: m.author, body: m.body, createdAt: m.createdAt })),
        }));
    });

export const decideAppeal = (userId: string, appealId: string, approve: boolean, note: string) =>
    query(async (db) => {
        const [row] = await db.select().from(appeal).where(eq(appeal.id, appealId));
        if (!row) return;
        await requireRole(db, userId, row.communityId, 'admin');
        if (row.status !== 'pending') return;
        const now = new Date();
        await db.transaction(async (tx) => {
            await tx
                .update(appeal)
                .set({
                    status: approve ? 'approved' : 'denied',
                    decisionNote: note.trim().slice(0, MAX_MESSAGE) || null,
                    decidedByUserId: userId,
                    decidedAt: now,
                })
                .where(eq(appeal.id, appealId));
            if (!approve) return;
            const [p] = await tx.select({ communityId: punishment.communityId }).from(punishment).where(eq(punishment.id, row.punishmentId));
            if (!p) return;
            if (p.communityId === row.communityId) {
                await tx.update(punishment).set({ revokedAt: now, revokedByUserId: userId }).where(eq(punishment.id, row.punishmentId));
            } else {
                await tx
                    .insert(punishmentOverride)
                    .values({ communityId: row.communityId, punishmentId: row.punishmentId, appealId, createdByUserId: userId, createdAt: now })
                    .onConflictDoNothing();
            }
        });
    });

export const addStaffMessage = (userId: string, appealId: string, message: string) =>
    query(async (db) => {
        const [row] = await db.select().from(appeal).where(eq(appeal.id, appealId));
        if (!row) return;
        await requireRole(db, userId, row.communityId, 'admin');
        const body = message.trim();
        if (body.length === 0 || body.length > MAX_MESSAGE) throw invalid(`Message must be 1-${MAX_MESSAGE} characters`);
        if (row.status !== 'pending') return;
        await db.insert(appealMessage).values({ id: crypto.randomUUID(), appealId, author: 'staff', body, createdAt: new Date() });
    });

export const listOverrides = (userId: string, communityId: string) =>
    query(async (db) => {
        await requireRole(db, userId, communityId, 'admin');
        return db
            .select({
                punishmentId: punishmentOverride.punishmentId,
                createdAt: punishmentOverride.createdAt,
                type: punishment.type,
                playerName: punishment.playerDisplayName,
                reason: punishment.reason,
            })
            .from(punishmentOverride)
            .innerJoin(punishment, eq(punishment.id, punishmentOverride.punishmentId))
            .where(eq(punishmentOverride.communityId, communityId))
            .orderBy(desc(punishmentOverride.createdAt));
    });

export const removeOverride = (userId: string, communityId: string, punishmentId: string) =>
    query(async (db) => {
        await requireRole(db, userId, communityId, 'admin');
        await db.transaction(async (tx) => {
            await tx
                .delete(punishmentOverride)
                .where(and(eq(punishmentOverride.communityId, communityId), eq(punishmentOverride.punishmentId, punishmentId)));
            const servers = (await tx.select({ uuid: server.uuid }).from(server).where(eq(server.communityId, communityId))).map((s) => s.uuid);
            // Clearing delivery history makes the next sync re-send the ban to this community's servers.
            if (servers.length > 0) {
                await tx
                    .delete(punishmentDelivery)
                    .where(and(eq(punishmentDelivery.punishmentId, punishmentId), inArray(punishmentDelivery.serverUuid, servers)));
            }
        });
    });
