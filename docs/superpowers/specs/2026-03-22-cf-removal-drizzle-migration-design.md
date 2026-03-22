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

```typescript
// src/server/db/index.ts
import { drizzle } from 'drizzle-orm/bun-sqlite'
// or for PostgreSQL:
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

export const db = drizzle(process.env.DATABASE_URL!, { schema })
export type Database = typeof db
```

PostgreSQL is used in all environments (dev, staging, prod). `drizzle-orm/node-postgres` with the `pg` driver, or `drizzle-orm/postgres-js` with `postgres.js` — to be confirmed against the V2 reference implementation.

### Custom JSONB type

To prevent double-serialization (Drizzle stringifying an already-stringified object), a custom column type wraps JSONB:

```typescript
// src/server/db/bun-jsonb.ts
import { customType } from 'drizzle-orm/pg-core'

export const jsonb = <T>() =>
  customType<{ data: T; driverData: string }>({
    dataType() { return 'jsonb' },
    toDriver(value: T): string { return JSON.stringify(value) },
    fromDriver(value: string): T { return typeof value === 'string' ? JSON.parse(value) : value },
  })
```

Used for encrypted envelope columns (`encryptedData`, `keyEnvelopes`) and config blobs.

### Drizzle config

```typescript
// drizzle.config.ts (repo root)
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
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

`AppEnv.Variables` gains a `services: Services` field. A services middleware (registered once at app startup) injects `createServices(db)` into every request context. Route handlers access services via `c.get('services')`. Hub-scoped methods receive `hubId` explicitly from `c.get('hubId')`.

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
    services: Services           // injected by services middleware
  }
}
```

```typescript
// src/server/middleware/services.ts
import { createMiddleware } from 'hono/factory'
import { createServices } from '../services'
import { db } from '../db'
import type { AppEnv } from '../types'

export const servicesMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set('services', createServices(db))
  await next()
})
```

The hub middleware is retained but updated: instead of calling `dos.settings.fetch(new Request(...))`, it calls `c.get('services').settings.getHub(hubId)`. The resolved `hubId` continues to be set on context and passed explicitly to service methods.

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
- `build:node` / `start:node` — esbuild bundle step; replaced by `bun run dev:server` and direct `bun` execution in Docker
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

`src/server/server.ts` runs `migrate()` on startup so dev and production always stay in sync without a separate manual step:

```typescript
// src/server/server.ts (simplified)
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from './db'

async function main() {
  // Run pending migrations before accepting traffic
  await migrate(db, { migrationsFolder: './drizzle/migrations' })

  const app = createApp()
  serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) })
}

main()
```

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
| Modify | `src/server/app.ts` | Register `servicesMiddleware`; remove DO namespace imports |
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
