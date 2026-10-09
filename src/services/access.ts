import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import type { Database } from '../db/client';
import { communityMember } from '../db/schema';
import { Db } from './db';
import { DatabaseError, Forbidden } from './errors';

export type Role = 'owner' | 'admin' | 'member';
const RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

export const query = <A>(f: (db: Database) => Promise<A>) =>
    Effect.gen(function* () {
        const db = yield* Db;
        return yield* Effect.tryPromise({
            try: () => f(db),
            catch: (cause) => (cause instanceof Forbidden ? cause : new DatabaseError({ cause })),
        });
    });

export const getRole = async (db: Database, userId: string, communityId: string): Promise<Role | null> => {
    const [row] = await db
        .select({ role: communityMember.role })
        .from(communityMember)
        .where(and(eq(communityMember.communityId, communityId), eq(communityMember.userId, userId)));
    return row?.role ?? null;
};

// Non-members get the same error as insufficient rank so community ids cannot be probed.
export const requireRole = async (db: Database, userId: string, communityId: string, min: Role) => {
    const role = await getRole(db, userId, communityId);
    if (!role || RANK[role] < RANK[min]) throw new Forbidden({ message: 'You do not have permission to do that' });
    return role;
};

export const outranks = (a: Role, b: Role) => RANK[a] > RANK[b];
