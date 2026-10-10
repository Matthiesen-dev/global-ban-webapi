# Global Ban WebAPI

The web API and dashboard for the [Global Ban](https://github.com/Matthiesen-dev/global-ban) Minecraft mod. Servers sync punishments to and from it with a single POST request, and server owners manage servers, communities and members in the dashboard.

Built with Astro (SSR, Node adapter), Effect v4, Drizzle on libSQL/SQLite, better-auth (GitHub sign-in) and Tailwind.

## Getting started

Requires Node 22.12+ and pnpm.

```sh
pnpm install
cp .env.example .env   # then fill in the values below
pnpm db:migrate
astro dev --background
```

Manage the dev server with `astro dev status`, `astro dev logs` and `astro dev stop`.

### Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | libSQL URL, e.g. `file:local.db` or a Turso URL |
| `DATABASE_AUTH_TOKEN` | Auth token for remote libSQL (leave empty for a local file) |
| `BETTER_AUTH_SECRET` | Long random secret used to sign sessions |
| `BETTER_AUTH_URL` | Public base URL of this app |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub OAuth app credentials. Set the callback URL to `<BETTER_AUTH_URL>/api/auth/callback/github` |

### Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` / `pnpm preview` | Production build (Node standalone) and preview |
| `pnpm check` | Type-check with `astro check` |
| `pnpm test` | Run the vitest suite (uses in-memory libSQL) |
| `pnpm db:generate` | Generate a migration after changing `src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations |

## Connecting a Minecraft server

1. Sign in to the dashboard with GitHub.
2. Open **Servers** and register the server using the UUID from the mod's server config. Treat this UUID as a secret: it is the only credential the mod sends.
3. Assign the server to a community. A server that is not in a community receives `403` from the sync endpoint.
4. In the mod's config, set `scheduler_apiSyncUrl` to `<your-host>/api/v1/sync`.

## Sync API

`POST /api/v1/sync`

Headers: `Content-Type: application/json`, `X-Global-Ban-UUID: <server uuid>`

The body and the response use the same shape, matching the mod's `SyncData` record (see [src/domain/punishment.ts](src/domain/punishment.ts)):

```json
{
  "punishments": [
    {
      "type": "ADD",
      "record": {
        "type": "BAN",
        "timestamp": 1700000000,
        "duration": -1,
        "playerUuid": "…",
        "playerIp": "203.0.113.7",
        "playerDisplayName": "Player",
        "punisherUuid": "…",
        "punisherDisplayName": "Moderator",
        "reason": "Griefing",
        "serverUuid": "…"
      }
    }
  ]
}
```

- Sync `type` is `ADD` or `REMOVE`. Punishment `type` is `BAN`, `IP_BAN` or `KICK`. `duration` of `-1` means permanent.
- The request carries the server's pending punishments. The response carries only what that server has not received yet: punishments from its community and from approved subscriptions, plus `REMOVE` for ones it was given that have since been revoked.
- Delivery is tracked per server, so repeating a request returns nothing new. Re-sending the same punishment is harmless.
- `serverUuid` in responses is the origin server's public id, never its secret UUID. Punishments whose origin server was deleted use the all-zero UUID.

| Status | Meaning |
| --- | --- |
| `200` | Success (the mod clears its pending queue on this) |
| `400` | Missing or invalid header, malformed JSON or body, or body over 1 MB |
| `403` | Server not registered, or not assigned to a community |
| `500` | Database error |

```sh
curl -X POST http://localhost:4321/api/v1/sync \
  -H 'Content-Type: application/json' \
  -H 'X-Global-Ban-UUID: 11111111-1111-4111-8111-111111111111' \
  -d '{"punishments":[]}'
```

## Dashboard

- **Servers:** register, move between communities, transfer or delete. Last sync time is shown per server.
- **Communities:** create communities, request to join, accept invites, subscribe to other communities.
- **Community page:** members and roles, invites by GitHub username, join requests, subscription approvals, ownership transfer and deletion.
- **Punishments:** punishments from your communities, with player IPs always masked. Admins can revoke.
- **Transfers:** accept, decline or cancel ownership offers.

### Roles and access

New accounts only see their own servers and communities.

| Role | Can do |
| --- | --- |
| Owner | Everything, including promoting admins, transferring ownership and deleting the community |
| Admin | Invite members, approve join requests, remove members, approve subscriptions, revoke punishments |
| Member | View members and punishments, add their own servers, leave |

- Invites are tied to a GitHub username and can only be accepted by that GitHub account.
- A subscription lets one community receive another's punishments. It stays pending until an admin of the source community approves it, and sync ignores pending ones.
- Removing a member detaches their servers from the community.
- Ownership transfers need the recipient to accept. A transferred server leaves its community if the new owner is not a member of it.
- Deleting a server or community requires typing its name. Deleting a community removes its punishment records. Deleting a server keeps the punishments it originated.

## Project layout

```
src/domain/     Effect schemas mirroring the mod's Java records, IP masking
src/db/         Drizzle schema and client
src/services/   Effect services: sync, dashboard, membership, ownership
src/pages/api/  /api/v1/sync and the better-auth handler
src/pages/dashboard/  Server-rendered dashboard pages
drizzle/        Generated SQL migrations
```

## License

This project is [MIT Licensed](./LICENSE)