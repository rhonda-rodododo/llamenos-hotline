# CF Removal + Drizzle/Zod Migration — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

This workstream removes Cloudflare Workers, Durable Objects, and Wrangler from the application stack and replaces the current DO-shim architecture with a Bun-native HTTP server backed by Drizzle ORM and Zod-validated schemas. The `site/` Astro marketing site remains on Cloudflare Pages and is entirely unaffected — it manages its own `site/package.json` and invokes `bunx wrangler` independently. No production instances exist, so no data migration is required: existing dev databases are dropped and recreated from Drizzle-generated migrations.

---

## Context

**Current backend:**
- Cloudflare Workers (`src/worker/`) + 7 Durable Objects: `IdentityDO`, `SettingsDO`, `RecordsDO`, `ShiftManagerDO`, `CallRouterDO`, `ConversationDO`, `BlastDO`
- Each DO extends `DurableObject<Env>`, wraps a `DORouter`, and dispatches `Request` objects to internal methods
- On Node.js, DOs are shimmed via `src/platform/node/durable-object.ts` using `PostgresStorage` (a `kv_store(namespace, key, value)` table with advisory locks to emulate DO single-writer guarantees)
- Route handlers call `getDOs(c.env)` then `dos.identity.fetch(new Request('http://do/volunteers'))` — routing through the shim even on Node.js

**Current storage:**
- `kv_store` table: `(namespace TEXT, key TEXT, value JSONB)` with `pg_advisory_xact_lock(hashtext(namespace))` per write
- All structured data serialized to JSONB, stored under string keys (`"volunteers"`, `"sessions:abc123"`, etc.)
- No relational integrity, no typed columns, no query capability beyond prefix scans

**Current dev workflow:**
- `bun run dev:worker` — `bunx wrangler dev` (requires CF account, DO bindings, wrangler config)
- `bun run dev` — Vite frontend only
- Node.js path via `src/platform/node/server.ts` already exists but still mounts `src/worker/app`

**Primary deployment:**
- Docker + Ansible VPS (from CF → VPS Migration workstream, already merged)
- `deploy:cloudflare` script was added as an optional CF deploy target — now being removed

**Reference implementation:**
- `~/projects/llamenos` (V2) already completed this migration using Bun SQL + Drizzle + service classes as the canonical pattern for this workstream

---

## What Gets Removed

| Path | Description |
|------|-------------|
| `src/worker/durable-objects/` | All 7 DO classes (`identity-do.ts`, `settings-do.ts`, `records-do.ts`, `shift-manager.ts`, `call-router.ts`, `conversation-do.ts`, `blast-do.ts`) |
| `src/worker/lib/do-router.ts` | DO-internal `DORouter` method+path dispatcher |
| `src/worker/lib/do-access.ts` | `getDOs()` / `getHubDOs()` factory, `DurableObjects` interface, `DOStub` usage |
| `src/platform/node/durable-object.ts` | Node.js DO shim (`NodeDurableObject` base class) |
| `src/platform/node/storage/postgres-storage.ts` | `PostgresStorage` KV shim (`kv_store` table adapter) |
| `src/platform/node/storage/alarm-poller.ts` | Alarm polling loop (DO alarm emulation) |
| `src/platform/node/storage/postgres-pool.ts` | Raw `postgres.js` pool (replaced by Drizzle + Bun SQL) |
| `src/platform/node/storage/startup-migrations.ts` | KV-shim SQL migrations runner |
| `src/platform/cloudflare.ts` | CF platform module |
| `src/platform/node/cf-types.d.ts` | Hand-rolled CF type shims (`DurableObjectState`, `DurableObjectStorage`, etc.) |
| `src/worker/types.ts` (partial) | `Env.CALL_ROUTER`, `SHIFT_MANAGER`, `IDENTITY_DO`, `SETTINGS_DO`, `RECORDS_DO`, `CONVERSATION_DO`, `BLAST_DO` bindings; `DOStub`, `DONamespace` interfaces |
| `wrangler.jsonc` | Entire Wrangler config (DO bindings, CF Worker entry, routes, cron triggers) |
| `esbuild.node.mjs` | Node.js bundle script (replaced by direct `bun` execution) |
| `scripts/` → `dev-tunnel.sh` | CF Tunnel dev script |
| `package.json` scripts | `dev:worker`, `deploy:cloudflare`, `deploy:demo`, `deploy:next`, `build:node`, `start:node`, `dev:tunnel` |
| `package.json` deps | `wrangler` (root), `@cloudflare/workers-types` |
| `.github/workflows/` | Any remaining `wrangler` install or deploy steps targeting the app Worker |
| `src/shared/migrations/` | DO-era SQL migration runner and migration files (superseded by Drizzle) |

---

## What Gets Renamed

| From | To | Notes |
|------|----|-------|
| `src/worker/` | `src/server/` | All subdirs move with it |
| `@worker/*` alias | `@server/*` | Updated in `tsconfig.json` and `vite.config.ts` |
| `src/platform/node/server.ts` | `src/server/server.ts` | Consolidated — no separate platform layer needed |
| `src/platform/node/env.ts` | `src/server/env.ts` | Env loading for Node/Bun runtime |
| `src/platform/node/blob-storage.ts` | `src/server/lib/blob-storage.ts` | MinIO/S3 adapter stays |
| `src/platform/node/transcription.ts` | `src/server/lib/transcription.ts` | Whisper HTTP client stays |
| `src/platform/types.ts` | `src/server/types.ts` | Platform-agnostic server types |

The `src/platform/` directory is deleted entirely after rename. The Cloudflare-specific shim layer disappears; the server becomes a single Bun-native process.

---

## Architecture: Service Layer

Seven DO classes are replaced by seven service classes in `src/server/services/`. Each service receives the database via constructor injection and exposes typed async methods. There is no `DORouter`, no `Request` dispatch, no shim indirection.

### Services interface and factory

```typescript
// src/server/services/index.ts

import type { Database } from '../db'
import { IdentityService } from './identity'
import { SettingsService } from './settings'
import { RecordsService } from './records'
import { ShiftService } from './shifts'
import { CallService } from './calls'
import { ConversationService } from './conversations'
import { BlastService } from './blasts'

export interface Services {
  identity: IdentityService
  settings: SettingsService
  records: RecordsService
  shifts: ShiftService
  calls: CallService
  conversations: ConversationService
  blasts: BlastService
}

export function createServices(db: Database): Services {
  return {
    identity: new IdentityService(db),
    settings: new SettingsService(db),
    records: new RecordsService(db),
    shifts: new ShiftService(db),
    calls: new CallService(db),
    conversations: new ConversationService(db),
    blasts: new BlastService(db),
  }
}
```

### Key principles

- `constructor(protected db: Database)` — pure dependency injection, no singletons, no global state
- Methods return typed domain objects (inferred from Drizzle or Zod schemas), never `Response`
- Business failures throw `AppError(status, message)` — one `errorHandler` middleware in `src/server/middleware/error.ts` catches and converts to JSON
- `hubId` is passed explicitly to all hub-scoped methods — no implicit global state, no closure capture
- Direct Drizzle queries — no `DORouter`, no `.fetch(new Request(...))` indirection, no HTTP-over-function-call

### Before (current pattern)

```typescript
// src/worker/routes/volunteers.ts
volunteers.get('/', async (c) => {
  const dos = getDOs(c.env)
  return dos.identity.fetch(new Request('http://do/volunteers'))
})
```

### After (new pattern)

```typescript
// src/server/routes/volunteers.ts
volunteers.get('/', async (c) => {
  const { identity } = c.get('services')
  const volunteers = await identity.listVolunteers()
  return c.json(volunteers)
})
```

---

## Architecture: Drizzle Schema

Schema files live in `src/server/db/schema/` — one file per domain. Drizzle-kit generates SQL migrations into `drizzle/migrations/`.

### Schema files and tables

| File | Tables |
|------|--------|
| `identity.ts` | `volunteers`, `invite_codes`, `webauthn_credentials`, `webauthn_challenges`, `server_sessions`, `device_links` |
| `settings.ts` | `hubs`, `roles`, `custom_fields`, `telephony_config`, `messaging_config`, `spam_settings`, `ban_list` |
| `records.ts` | `audit_log`, `call_records`, `note_envelopes` |
| `shifts.ts` | `shift_schedules`, `shift_overrides`, `ring_groups`, `active_shifts` |
| `calls.ts` | `active_calls`, `call_legs`, `ringing_queue` |
| `conversations.ts` | `conversations`, `message_envelopes`, `conversation_assignments` |
| `blasts.ts` | `blasts`, `blast_recipients`, `blast_deliveries` |

### Database setup

Uses Bun's native SQL driver (not `node-postgres` or `postgres.js`) — matching V2's setup exactly:

```typescript
// src/server/db/index.ts
import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from './schema'

let _db: ReturnType<typeof createDatabase> | null = null

export function createDatabase(url: string) {
  const client = new SQL({
    url,
    max: parseInt(process.env.PG_POOL_SIZE ?? '10'),
    idleTimeout: parseInt(process.env.PG_IDLE_TIMEOUT ?? '30'),
    connectionTimeout: 30,
  })
  return drizzle({ client, schema })
}

export function getDb() {
  if (!_db) throw new Error('Database not initialized — call initDb() first')
  return _db
}

export function initDb(url: string) {
  _db = createDatabase(url)
  return _db
}

export type Database = ReturnType<typeof createDatabase>
```

### Custom JSONB type

Bun's native SQL driver serializes objects to JSONB natively — calling `JSON.stringify` in `toDriver` causes double-serialization (objects stored as escaped JSON strings instead of JSONB objects). The custom type omits `toDriver` and passes values through `fromDriver` unchanged:

```typescript
// src/server/db/bun-jsonb.ts
import { customType } from 'drizzle-orm/pg-core'

export const jsonb = <T>() =>
  customType<{ data: T; driverData: T }>({
    dataType() { return 'jsonb' },
    // No toDriver — Bun SQL handles object → JSONB natively
    fromDriver(value: T): T { return value },
  })
```

Used for encrypted envelope columns (`encryptedData`, `keyEnvelopes`) and config blobs.

### Drizzle config

```typescript
// drizzle.config.ts (repo root)
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  // Using index.ts re-export rather than glob (*.ts) — either works,
  // but explicit re-export avoids drizzle-kit scanning non-schema files.
  schema: './src/server/db/schema/index.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

---

## Architecture: Zod Schemas

Zod schemas live in `src/shared/schemas/` — one file per domain, importable by both client and server. This replaces ad-hoc casting and manual type duplication throughout the codebase.

### Three-layer type system

| Layer | Location | Purpose |
|-------|----------|---------|
| Drizzle inferred types | `src/server/db/schema/*.ts` | Raw DB row shapes — server-only, never sent to client |
| Zod response schemas | `src/shared/schemas/*.ts` | API wire format — shared client+server, used for `c.json()` output and client `fetch` parsing |
| Zod input schemas | `src/shared/schemas/*.ts` | Request body validation — used via Hono's `zValidator` middleware |

```typescript
// src/shared/schemas/volunteers.ts
import { z } from 'zod'

// Response shape (wire format — safe subset of DB row)
export const VolunteerSchema = z.object({
  pubkey: z.string(),
  name: z.string(),
  roles: z.array(z.string()),
  hubRoles: z.array(z.object({ hubId: z.string(), roleIds: z.array(z.string()) })),
  createdAt: z.string().datetime(),
})
export type Volunteer = z.infer<typeof VolunteerSchema>

// Input schema (request body for POST /volunteers)
export const CreateVolunteerSchema = z.object({
  pubkey: z.string().length(64),
  name: z.string().min(1).max(100),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  roleIds: z.array(z.string()).default(['role-volunteer']),
})
export type CreateVolunteerInput = z.infer<typeof CreateVolunteerSchema>
```

All types are derived via `z.infer<>` — no manual `interface` duplication. Existing `src/shared/types.ts` is refactored: types now covered by Zod schemas (e.g. `Volunteer`, `InviteCode`, `ServerSession`, `NotePayload`) are removed and replaced with `z.infer<>` imports. Types that are purely cryptographic or telephony-structural and have no wire format (e.g. `RecipientEnvelope`, `KeyEnvelope`, `TelephonyProviderConfig`) remain in `src/shared/types.ts`.

---

## Hono Context

`AppEnv.Variables` gains a `services: Services` field. Services are created **once at startup** (not per-request) and closed over in the middleware — matching V2's pattern. This avoids allocating seven class instances on every request while keeping services stateless and testable.

```typescript
// src/server/types.ts
import type { Services } from './services'

export type AppEnv = {
  Variables: {
    pubkey: string
    volunteer: Volunteer
    permissions: string[]
    allRoles: Role[]
    hubId?: string
    hubPermissions?: string[]
    services: Services           // singleton, injected at startup
  }
}
```

```typescript
// src/server/server.ts (startup wiring — simplified)
const db = initDb(env.DATABASE_URL)
const services = createServices(db)   // created once

const app = createApp()
app.use('*', async (c, next) => {
  c.set('services', services)         // reference shared singleton
  await next()
})
```

The hub middleware is retained but updated: instead of calling `dos.settings.fetch(new Request(...))`, it calls `c.get('services').settings.getHub(hubId)`. The resolved `hubId` continues to be set on context and passed explicitly to service methods.

---

## Adapter Factories (getTelephony / getMessagingAdapter / getNostrPublisher)

`src/worker/lib/do-access.ts` currently exports three adapter factory functions beyond `getDOs`:
- `getTelephony(env, dos)` / `getHubTelephony(env, hubId)` — reads telephony config from SettingsDO, instantiates the correct `TelephonyAdapter`
- `getMessagingAdapter(channel, dos, hmacSecret)` — reads messaging config from SettingsDO, instantiates the correct `MessagingAdapter`
- `getNostrPublisher(env)` — creates `CFNostrPublisher` (CF service binding) or `NodeNostrPublisher`

These are used in `src/server/routes/telephony.ts`, `src/server/messaging/router.ts`, `src/server/lib/nostr-events.ts`, `src/server/routes/conversations.ts`, and `src/server/routes/reports.ts`.

After `do-access.ts` is deleted, these factories move to `src/server/lib/adapters.ts`:
- `getTelephony(settings: SettingsService, hubId?: string)` — calls `settings.getTelephonyConfig(hubId)` then dispatches to the correct adapter
- `getMessagingAdapter(channel, settings: SettingsService, hmacSecret)` — same pattern
- `getNostrPublisher(env)` — `CFNostrPublisher` is deleted (CF service binding removed); only `NodeNostrPublisher` remains

All call sites are updated to import from `src/server/lib/adapters.ts` and pass the `settings` service instead of `env` + DO stubs.

---

## Existing `src/worker/services/` Files

Three existing service files in `src/worker/services/` (not DO classes) use DO access and must be migrated:

- `audit.ts` — currently calls `records.fetch(new Request('http://do/audit', ...))`. Absorbed into `RecordsService` (audit log methods move there) or becomes a thin wrapper calling `services.records.addAuditEntry(...)` directly.
- `ringing.ts` — calls `dos.shifts.fetch(...)`, `dos.settings.fetch(...)`, `dos.calls.fetch(...)`, `dos.identity.fetch(...)`. Refactored to receive a `Services` object and call service methods directly. Moved to `src/server/lib/ringing.ts`.
- `transcription.ts` — calls `dos.settings.fetch(...)` and `dos.identity.fetch(...)`. Refactored to take `settings: SettingsService` and `identity: IdentityService` as constructor/function params. Moved to `src/server/lib/transcription-manager.ts`.

These files are listed explicitly in the Files Created/Modified table.

---

## Demo Reset Scheduler

`src/worker/index.ts` currently has a `scheduled()` CF Cron Trigger handler that resets all 7 DOs every 4 hours when `DEMO_MODE=true`. After `wrangler.jsonc` and `src/worker/index.ts` are deleted, this is replaced by:

**Host cron** (already provisioned by the CF → VPS Demo Migration workstream): the Ansible demo role installs a crontab entry (`0 */4 * * *`) that calls `POST /api/test-reset` with `X-Test-Secret`. No application-level scheduler is needed — the reset endpoint already exists in `src/server/routes/dev.ts` and works for `ENVIRONMENT=demo`. The `scheduled()` export is simply deleted; the host cron takes over.

---

## Dev Workflow

### New scripts (package.json)

```json
{
  "dev": "vite",
  "dev:server": "bun --watch src/server/server.ts",
  "build": "vite build",
  "migrate": "bunx drizzle-kit migrate",
  "migrate:generate": "bunx drizzle-kit generate",
  "typecheck": "bunx tsc --noEmit",
  "test": "bunx playwright test",
  "test:ui": "bunx playwright test --ui",
  "bootstrap-admin": "bun run scripts/bootstrap-admin.ts",
  "site:dev": "cd site && bun run dev",
  "site:build": "cd site && bun run build",
  "deploy": "bun run deploy:site",
  "deploy:site": "cd site && bun run deploy",
  "changelog": "git-cliff --output CHANGELOG.md",
  "changelog:preview": "git-cliff --unreleased",
  "version:bump": "bun run scripts/bump-version.ts"
}
```

### Removed scripts

- `dev:worker` — wrangler dev, no longer needed
- `deploy:cloudflare` / `deploy:demo` / `deploy:next` — CF Worker deploy targets
- `build:node` / `start:bun` — esbuild bundle step and old platform entrypoint; replaced by `bun run dev:server` pointing at `src/server/server.ts`
- `dev:tunnel` — CF Tunnel script

### Removed root dependencies

- `wrangler` — root package only; `site/package.json` retains `bunx wrangler` via devDependencies
- `@cloudflare/workers-types`

### Full local dev flow

```bash
bun run dev:docker        # Start postgres, minio, strfry (port-offset for v1 concurrent dev)
bun run migrate           # Apply pending Drizzle migrations to dev DB
bun run dev               # Vite frontend (localhost:5173)
bun run dev:server        # Bun server with --watch (localhost:3000)
```

The `dev:docker` script (already defined in the VPS migration workstream) starts the v1 port-offset Docker Compose stack. The Vite dev server proxies `/api/` and `/telephony/` to `localhost:3000`.

---

## CI Changes

- Remove any remaining `bunx wrangler` install or authentication steps in GitHub Actions workflows targeting the app (`.github/workflows/`)
- `site/` deploy workflow is unaffected — it runs `cd site && bun run deploy` independently
- Add `bun run migrate` step before E2E server startup in the test job (ensures test database schema is current)
- Build job: no CF Worker bundle to build or checksum — only `vite build` for the SPA and the Docker image build
- Remove any `wrangler.jsonc` linting or validation steps

---

## Migration Strategy

No data migration is needed — there are no production instances and no data to preserve. The process for each developer and for CI:

1. Drop the existing dev database (or the entire Docker volume)
2. Run `bun run migrate` — Drizzle-kit applies all migrations in `drizzle/migrations/` in order
3. Run `bun run bootstrap-admin` to regenerate the admin keypair

### Programmatic migration on boot

`src/server/server.ts` runs `migrate()` on startup using the `bun-sql` migrator (matching the driver):

```typescript
// src/server/server.ts (simplified)
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { initDb } from './db'

async function main() {
  const db = initDb(process.env.DATABASE_URL!)
  // Run pending migrations before accepting traffic
  await migrate(db, { migrationsFolder: './drizzle/migrations' })

  const services = createServices(db)
  const app = createApp(services)
  serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) })
}

main()
```

The `bun run migrate` script (`bunx drizzle-kit migrate`) is also available for running migrations manually (e.g., in CI before the E2E job, or during local dev before starting the server). The startup `migrate()` call is the safety net that ensures production and Docker deployments never lag behind schema. Both paths use the same `drizzle/migrations/` folder and are idempotent.

Drizzle-kit generates SQL migrations from schema file diffs via `bun run migrate:generate`. Migrations are committed to the repository and applied deterministically in CI and production.

---

## Files Created / Modified

| Action | Path | Notes |
|--------|------|-------|
| Create | `src/server/db/index.ts` | Drizzle client + `Database` type |
| Create | `src/server/db/bun-jsonb.ts` | Custom JSONB column type |
| Create | `src/server/db/schema/index.ts` | Re-exports all schema files |
| Create | `src/server/db/schema/identity.ts` | volunteers, invites, webauthn, sessions |
| Create | `src/server/db/schema/settings.ts` | hubs, roles, custom fields, telephony/messaging config, bans |
| Create | `src/server/db/schema/records.ts` | audit log, call records, note envelopes |
| Create | `src/server/db/schema/shifts.ts` | schedules, overrides, ring groups, active shifts |
| Create | `src/server/db/schema/calls.ts` | active calls, call legs, ringing queue |
| Create | `src/server/db/schema/conversations.ts` | conversations, message envelopes, assignments |
| Create | `src/server/db/schema/blasts.ts` | blasts, recipients, deliveries |
| Create | `src/server/services/index.ts` | `Services` interface + `createServices()` factory |
| Create | `src/server/services/identity.ts` | Replaces `IdentityDO` |
| Create | `src/server/services/settings.ts` | Replaces `SettingsDO` |
| Create | `src/server/services/records.ts` | Replaces `RecordsDO` |
| Create | `src/server/services/shifts.ts` | Replaces `ShiftManagerDO` |
| Create | `src/server/services/calls.ts` | Replaces `CallRouterDO` |
| Create | `src/server/services/conversations.ts` | Replaces `ConversationDO` |
| Create | `src/server/services/blasts.ts` | Replaces `BlastDO` |
| Create | `src/server/middleware/services.ts` | Services injection middleware |
| Create | `src/server/middleware/error.ts` | `AppError` + `errorHandler` middleware |
| Create | `src/shared/schemas/index.ts` | Re-exports all Zod schema files |
| Create | `src/shared/schemas/volunteers.ts` | `VolunteerSchema`, `CreateVolunteerSchema`, etc. |
| Create | `src/shared/schemas/settings.ts` | Hub, role, config schemas |
| Create | `src/shared/schemas/records.ts` | Audit log, call record, note schemas |
| Create | `src/shared/schemas/shifts.ts` | Shift schedule and ring group schemas |
| Create | `src/shared/schemas/calls.ts` | Active call and leg schemas |
| Create | `src/shared/schemas/conversations.ts` | Conversation and message schemas |
| Create | `src/shared/schemas/blasts.ts` | Blast and recipient schemas |
| Create | `drizzle.config.ts` | Drizzle-kit config (schema path, output, dialect, DB URL) |
| Create | `drizzle/migrations/` | Directory for generated SQL migrations (git-tracked) |
| Rename | `src/worker/` → `src/server/` | All app backend code moves here |
| Rename | `src/platform/node/server.ts` → `src/server/server.ts` | Consolidated entry point |
| Rename | `src/platform/node/env.ts` → `src/server/env.ts` | Runtime env loading |
| Rename | `src/platform/node/blob-storage.ts` → `src/server/lib/blob-storage.ts` | MinIO/S3 adapter |
| Rename | `src/platform/node/transcription.ts` → `src/server/lib/transcription.ts` | Whisper HTTP client |
| Rename | `src/platform/types.ts` → `src/server/types.ts` | AppEnv + platform types |
| Modify | `src/server/types.ts` | Add `services: Services` to `AppEnv.Variables`; remove `DOStub`, `DONamespace`, DO bindings from `Env` |
| Modify | `src/server/middleware/hub.ts` | Replace `getDOs(c.env).settings.fetch(...)` with `c.get('services').settings.getHub(hubId)` |
| Modify | `src/server/middleware/auth.ts` | Replace DO access with service calls |
| Modify | `src/server/routes/*.ts` | All 25 route files: replace `getDOs(c.env)` pattern with `c.get('services')` |
| Modify | `src/server/messaging/router.ts` | Replace `getScopedDOs`, `getMessagingAdapter`, `getNostrPublisher` with service calls and `src/server/lib/adapters.ts` |
| Modify | `src/server/app.ts` | Register services singleton in startup; remove DO namespace imports |
| Create | `src/server/lib/adapters.ts` | `getTelephony`, `getMessagingAdapter`, `getNostrPublisher` (CF variant deleted) |
| Rename/Modify | `src/worker/services/ringing.ts` → `src/server/lib/ringing.ts` | Replace DO access with `Services` dependency |
| Rename/Modify | `src/worker/services/transcription.ts` → `src/server/lib/transcription-manager.ts` | Replace DO access with service params |
| Delete/Absorb | `src/worker/services/audit.ts` | Audit log methods absorbed into `RecordsService` |
| Modify | `src/shared/types.ts` | Remove types superseded by Zod schemas; retain crypto/telephony structural types |
| Modify | `tsconfig.json` | Rename `@worker/*` alias to `@server/*`; remove `@cloudflare/workers-types` |
| Modify | `vite.config.ts` | Update path alias `@worker` → `@server` |
| Modify | `package.json` | Update scripts (see Dev Workflow section); remove wrangler/CF deps |
| Modify | `.github/workflows/*.yml` | Remove wrangler app deploy steps; add `bun run migrate` before E2E |
| Modify | `docker-compose.yml` | Update server start command from `node dist/server/index.js` to `bun src/server/server.ts` (or built image entrypoint) |
| Modify | `Dockerfile` | Remove esbuild bundle step; use `bun` directly |
| Delete | `src/worker/durable-objects/` | All 7 DO files |
| Delete | `src/worker/lib/do-router.ts` | DORouter dispatcher |
| Delete | `src/worker/lib/do-access.ts` | getDOs factory |
| Delete | `src/platform/node/durable-object.ts` | Node DO shim |
| Delete | `src/platform/node/storage/postgres-storage.ts` | KV shim |
| Delete | `src/platform/node/storage/alarm-poller.ts` | Alarm poller |
| Delete | `src/platform/node/storage/postgres-pool.ts` | Raw postgres.js pool |
| Delete | `src/platform/node/storage/startup-migrations.ts` | KV-shim migration runner |
| Delete | `src/platform/node/cf-types.d.ts` | Hand-rolled CF type shims |
| Delete | `src/platform/cloudflare.ts` | CF platform module |
| Delete | `src/platform/` | Entire directory (empty after renames and deletes) |
| Delete | `src/shared/migrations/` | DO-era migration runner and SQL files |
| Delete | `wrangler.jsonc` | Entire Wrangler config |
| Delete | `esbuild.node.mjs` | Node.js bundle script |
| Delete | `scripts/dev-tunnel.sh` | CF Tunnel dev script |
