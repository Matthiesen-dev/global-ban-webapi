import { Schema } from 'effect';

// Mirrors dev.matthiesen.global_ban.common.def.PunishmentType (Gson writes the constant name).
export const PunishmentType = Schema.Literals(['BAN', 'IP_BAN', 'KICK']);
export type PunishmentType = typeof PunishmentType.Type;

// Mirrors dev.matthiesen.global_ban.common.def.SyncType.
export const SyncType = Schema.Literals(['ADD', 'REMOVE']);
export type SyncType = typeof SyncType.Type;

export const Uuid = Schema.String.check(Schema.isUUID());

/** duration value meaning the punishment never expires. */
export const NON_EXPIRING_PUNISHMENT = -1;

/** The punisher UUID is unknown or not applicable. */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** The player display name is unknown or not applicable. */
export const UNKNOWN_PLAYER = 'UnknownPlayer';

/** The player IP is unknown or not applicable. */
export const UNDEFINED_IP = 'undefined';

/** Only these types are synced through the API and appealable; KICK stays mod-side. */
export const APPEALABLE_TYPES = ['BAN', 'IP_BAN'] as const;

// Both timestamp and duration are in seconds (the mod compares against System.currentTimeMillis() / 1000).
export const isExpired = (p: { timestamp: number; duration: number }, nowMs: number): boolean =>
    p.duration !== NON_EXPIRING_PUNISHMENT && (p.timestamp + p.duration) * 1000 <= nowMs;

export const isActive = (p: { timestamp: number; duration: number; revokedAt: Date | null }, nowMs: number): boolean =>
    p.revokedAt === null && !isExpired(p, nowMs);

// Mirrors dev.matthiesen.global_ban.common.def.PunishmentRecord.
export const PunishmentRecord = Schema.Struct({
    type: PunishmentType,
    timestamp: Schema.Number.check(Schema.isInt()),
    duration: Schema.Number.check(Schema.isInt()),
    playerUuid: Uuid,
    playerIp: Schema.String,
    playerDisplayName: Schema.String,
    punisherUuid: Uuid,
    punisherDisplayName: Schema.String,
    reason: Schema.String,
    serverUuid: Uuid,
});
export type PunishmentRecord = typeof PunishmentRecord.Type;

// Mirrors PunishmentRecord.Sync.
export const PunishmentSync = Schema.Struct({
    record: PunishmentRecord,
    type: SyncType,
});
export type PunishmentSync = typeof PunishmentSync.Type;

// Mirrors dev.matthiesen.global_ban.common.def.SyncData.
export const SyncData = Schema.Struct({
    punishments: Schema.Array(PunishmentSync),
});
export type SyncData = typeof SyncData.Type;
