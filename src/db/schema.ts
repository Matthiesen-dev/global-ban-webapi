import { relations } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// better-auth core tables (field names must match what the adapter expects).
export const user = sqliteTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const session = sqliteTable('session', {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const account = sqliteTable('account', {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const verification = sqliteTable('verification', {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
});

export const community = sqliteTable('community', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    ownerUserId: text('owner_user_id').notNull().references(() => user.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const communityMember = sqliteTable(
    'community_member',
    {
        communityId: text('community_id').notNull().references(() => community.id, { onDelete: 'cascade' }),
        userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
        role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
    },
    (t) => [primaryKey({ columns: [t.communityId, t.userId] })],
);

// `uuid` is the secret from the mod's config; `publicId` is the only id other servers ever see.
export const server = sqliteTable('server', {
    uuid: text('uuid').primaryKey(),
    publicId: text('public_id').notNull().unique(),
    name: text('name').notNull(),
    ownerUserId: text('owner_user_id').notNull().references(() => user.id),
    communityId: text('community_id').references(() => community.id, { onDelete: 'set null' }),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const communitySubscription = sqliteTable(
    'community_subscription',
    {
        subscriberCommunityId: text('subscriber_community_id').notNull().references(() => community.id, { onDelete: 'cascade' }),
        sourceCommunityId: text('source_community_id').notNull().references(() => community.id, { onDelete: 'cascade' }),
    },
    (t) => [primaryKey({ columns: [t.subscriberCommunityId, t.sourceCommunityId] })],
);

export const punishment = sqliteTable(
    'punishment',
    {
        id: text('id').primaryKey(),
        communityId: text('community_id').notNull().references(() => community.id, { onDelete: 'cascade' }),
        originServerUuid: text('origin_server_uuid').notNull().references(() => server.uuid, { onDelete: 'cascade' }),
        type: text('type', { enum: ['BAN', 'IP_BAN', 'KICK'] }).notNull(),
        timestamp: integer('timestamp').notNull(),
        duration: integer('duration').notNull(),
        playerUuid: text('player_uuid').notNull(),
        playerIp: text('player_ip').notNull(),
        playerDisplayName: text('player_display_name').notNull(),
        punisherUuid: text('punisher_uuid').notNull(),
        punisherDisplayName: text('punisher_display_name').notNull(),
        reason: text('reason').notNull(),
        revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
        createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    },
    (t) => [
        uniqueIndex('punishment_natural_key').on(t.playerUuid, t.type, t.timestamp, t.originServerUuid),
        index('punishment_community_idx').on(t.communityId),
    ],
);

// One row per (server, punishment, direction) already handed to or received from a server.
export const punishmentDelivery = sqliteTable(
    'punishment_delivery',
    {
        serverUuid: text('server_uuid').notNull().references(() => server.uuid, { onDelete: 'cascade' }),
        punishmentId: text('punishment_id').notNull().references(() => punishment.id, { onDelete: 'cascade' }),
        syncType: text('sync_type', { enum: ['ADD', 'REMOVE'] }).notNull(),
        deliveredAt: integer('delivered_at', { mode: 'timestamp_ms' }).notNull(),
    },
    (t) => [primaryKey({ columns: [t.serverUuid, t.punishmentId, t.syncType] })],
);

export const serverRelations = relations(server, ({ one }) => ({
    community: one(community, { fields: [server.communityId], references: [community.id] }),
}));
