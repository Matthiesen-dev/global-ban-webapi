import { Schema, SchemaGetter } from "effect";
import { NIL_UUID, NON_EXPIRING_PUNISHMENT, PunishmentRecord, UNDEFINED_IP, UNKNOWN_PLAYER } from "../domain/punishment";

/** Simple UUID schema. */
export const Uuid = Schema.String.check(Schema.isUUID());

/** Expiration schema for vanilla Minecraft ban entries. */
export const expirationSchema = Schema.Union([
    Schema.Literal("forever"),
    Schema.DateFromString
]);

/** A vanilla player ban entry. */
export const VanillaPlayerBanEntry = Schema.Struct({
    uuid: Uuid,
    name: Schema.String,
    created: Schema.DateFromString,
    source: Schema.String,
    expires: expirationSchema,
    reason: Schema.String,
});

/** An array of vanilla player ban entries. */
export const VanillaPlayerBanListJson = Schema.Array(VanillaPlayerBanEntry);

/** A vanilla IP ban entry. */
export const VanillaIpBanEntry = Schema.Struct({
    ip: Schema.String,
    created: Schema.DateFromString,
    source: Schema.String,
    expires: expirationSchema,
    reason: Schema.String,
});

/** An array of vanilla IP ban entries. */
export const VanillaIpBanListJson = Schema.Array(VanillaIpBanEntry);

// Vanilla stores an absolute expiry; PunishmentRecord stores seconds since `timestamp`.
const toDuration = (created: Date, expires: Date | "forever") =>
    expires === "forever" ? NON_EXPIRING_PUNISHMENT : Math.max(0, Math.round((expires.getTime() - created.getTime()) / 1000));

/** Converts a vanilla player ban list JSON to an array of PunishmentRecords. */
export const VanillaPlayerBansToPunishment = (serverUuid: string) => VanillaPlayerBanListJson.pipe(
    Schema.decodeTo(Schema.Array(PunishmentRecord), {
        decode: SchemaGetter.transform((data) => data.map((entry) => {
            return {
                type: "BAN" as const,
                timestamp: Math.floor(entry.created.getTime() / 1000),
                duration: toDuration(entry.created, entry.expires),
                playerUuid: entry.uuid,
                playerIp: UNDEFINED_IP,
                playerDisplayName: entry.name,
                punisherUuid: NIL_UUID,
                punisherDisplayName: entry.source,
                reason: entry.reason,
                serverUuid: serverUuid
            }
        })),
        encode: SchemaGetter.forbidden(
            () => "Encoding not supported"
        )
    })
);

/** Converts a vanilla IP ban list to an array of PunishmentRecords. */
export const VanillaIpBansToPunishment = (serverUuid: string) => VanillaIpBanListJson.pipe(
    Schema.decodeTo(Schema.Array(PunishmentRecord), {
        decode: SchemaGetter.transform((data) => data.map((entry) => {
            return {
                type: "IP_BAN" as const,
                timestamp: Math.floor(entry.created.getTime() / 1000),
                duration: toDuration(entry.created, entry.expires),
                playerUuid: NIL_UUID,
                playerIp: entry.ip,
                playerDisplayName: UNKNOWN_PLAYER,
                punisherUuid: NIL_UUID,
                punisherDisplayName: entry.source,
                reason: entry.reason,
                serverUuid: serverUuid
            }
        })),
        encode: SchemaGetter.forbidden(
            () => "Encoding not supported"
        )
    })
);