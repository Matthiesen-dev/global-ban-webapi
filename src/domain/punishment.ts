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
