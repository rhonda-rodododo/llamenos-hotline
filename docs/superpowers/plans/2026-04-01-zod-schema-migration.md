# Zod Schema Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@shared/schemas/` the single source of truth for ALL types used by backend and frontend — eliminating duplicate type definitions, adding runtime validation, and generating OpenAPI documentation.

**Architecture:** Schema files in `src/shared/schemas/` define zod schemas. Types are derived via `z.infer<>` and exported alongside schemas. Route files import schemas for `createRoute()` validation. React Query hooks import types from schemas. `src/shared/types.ts` re-exports from schemas (no more duplicate definitions). `src/client/lib/api.ts` imports types from schemas for return type annotations.

**Tech Stack:** zod v4, @hono/zod-openapi (OpenAPIHono + createRoute), @tanstack/react-query (queryOptions), Scalar docs

**Current state:** 1 of 35 route files converted (report-types.ts). 72 schema types already exported. 66 types in types.ts (16 duplicated in schemas). 0 query hooks import from schemas. 0 api.ts functions import from schemas.

---

## Phase A: Schema Consolidation (types.ts → schemas)

The goal is to make schemas the canonical type source. After this phase, `types.ts` re-exports from schemas instead of defining duplicates.

### Task A1: Add missing response/entity schemas

**Files:**
- Modify: `src/shared/schemas/settings.ts` — add WebAuthnSettings, RetentionSettings, GeocodingConfig, SetupState, EnabledChannels
- Modify: `src/shared/schemas/blasts.ts` — add BlastContent, BlastStats, BlastSettings
- Modify: `src/shared/schemas/records.ts` — add NotePayload, KeyEnvelope
- Create: `src/shared/schemas/files.ts` — FileRecord, EncryptedFileMetadata, UploadInit
- Create: `src/shared/schemas/common.ts` — shared enums (ContactType, RiskLevel, LocationPrecision, MessageDeliveryStatus, etc.)

For each schema added, export both the schema and the `z.infer<>` type.

- [ ] **Step 1:** Add missing schemas to `settings.ts` — WebAuthnSettings, RetentionSettings, GeocodingConfig, SetupState, EnabledChannels. Check current types.ts definitions (lines 488-575) for the exact shape.
- [ ] **Step 2:** Add missing schemas to `blasts.ts` — BlastContent, BlastStats, BlastSettings. Check types.ts lines 461-510.
- [ ] **Step 3:** Add NotePayload and KeyEnvelope schemas to `records.ts`. Check types.ts lines 11-15, 323-326.
- [ ] **Step 4:** Create `files.ts` schema for FileRecord, EncryptedFileMetadata, UploadInit. Check types.ts lines 264-320.
- [ ] **Step 5:** Create `common.ts` schema for shared enums: ContactType, RiskLevel, LocationPrecision, CallPreference, MessageDeliveryStatus, MessagingChannelType, ChannelType, CustomFieldContext. Check types.ts for definitions.
- [ ] **Step 6:** Update `src/shared/schemas/index.ts` to re-export new files.
- [ ] **Step 7:** Run `bun run typecheck` to verify all schemas compile.
- [ ] **Step 8:** Commit: `feat: add remaining entity schemas for single source of truth`

### Task A2: Replace duplicate types in types.ts with re-exports

**Files:**
- Modify: `src/shared/types.ts` — replace interface definitions with imports from schemas

The 16 duplicate types identified:
- RecipientEnvelope, CustomFieldDefinition, Hub, ReportType, CreateReportTypeInput, UpdateReportTypeInput (from settings.ts/records.ts/report-types.ts)
- Blast, BlastContent, BlastStats, Subscriber, SubscriberChannel (from blasts.ts)
- SMSConfig, WhatsAppConfig, RCSConfig, SignalConfig, MessagingConfig (from providers.ts)
- RetentionSettings (from settings.ts, after Task A1)

For each duplicate: delete the interface definition from types.ts, add `export type { TypeName } from '@shared/schemas/...'` re-export.

Types that DON'T exist in schemas yet (TelephonyProviderDraft, OAuthState, ProviderConfig, SipTrunkConfig, etc.) stay in types.ts — these are internal/draft types not exposed via API.

- [ ] **Step 1:** Replace messaging config types (SMSConfig, WhatsAppConfig, SignalConfig, RCSConfig, MessagingConfig) with re-exports from `@shared/schemas/providers`.
- [ ] **Step 2:** Replace blast types (Blast, BlastContent, BlastStats, Subscriber, SubscriberChannel) with re-exports from `@shared/schemas/blasts`.
- [ ] **Step 3:** Replace RecipientEnvelope with re-export from `@shared/schemas/records`. Update KeyEnvelope to use the schema type.
- [ ] **Step 4:** Replace CustomFieldDefinition, Hub, RetentionSettings with re-exports from `@shared/schemas/settings`.
- [ ] **Step 5:** Replace ReportType, CreateReportTypeInput, UpdateReportTypeInput with re-exports from `@shared/schemas/report-types`.
- [ ] **Step 6:** Replace ContactType, RiskLevel enums with re-exports from `@shared/schemas/common`.
- [ ] **Step 7:** Run `bun run typecheck` — fix any import path issues in files that imported these types from types.ts.
- [ ] **Step 8:** Run `bun run build` to verify frontend compiles.
- [ ] **Step 9:** Commit: `refactor: replace duplicate types in types.ts with schema re-exports`

## Phase B: API Layer Migration

### Task B1: Update api.ts to import types from schemas

**Files:**
- Modify: `src/client/lib/api.ts` — change import sources from `@shared/types` to `@shared/schemas`

There are 16 imports from `@shared/types` in api.ts. After Phase A, many of these types are re-exports from schemas. Change imports to point directly at schemas for types that have schemas. Keep types.ts imports for internal types (TelephonyProviderDraft, OAuthState, etc.).

- [ ] **Step 1:** Change `import { CustomFieldDefinition } from '@shared/types'` to `import type { CustomFieldDefinition } from '@shared/schemas'`.
- [ ] **Step 2:** Change all other schema-available type imports: RecipientEnvelope, Blast, Subscriber, Hub, ReportType, MessagingConfig, RetentionSettings, etc.
- [ ] **Step 3:** Add return type annotations to key API functions using schema types: `listShifts(): Promise<{ shifts: ShiftSchedule[] }>`, etc.
- [ ] **Step 4:** Run `bun run typecheck` and fix any issues.
- [ ] **Step 5:** Commit: `refactor: api.ts imports types from @shared/schemas`

### Task B2: Update React Query hooks to use schema types

**Files:**
- Modify: all 18 query files in `src/client/lib/queries/` that import from `@/lib/api`

For each query file:
1. Import types from `@shared/schemas` instead of from `@/lib/api`
2. Ensure `queryOptions` generic parameter uses the schema type
3. Keep API function imports from `@/lib/api` (the functions, not the types)

- [ ] **Step 1:** Update `queries/shifts.ts` — import `ShiftSchedule` from `@shared/schemas`, type queryFn return.
- [ ] **Step 2:** Update `queries/roles.ts` — import `Role` (was RoleDefinition).
- [ ] **Step 3:** Update `queries/teams.ts`, `queries/tags.ts`, `queries/blasts.ts`, `queries/hubs.ts`.
- [ ] **Step 4:** Update `queries/notes.ts`, `queries/calls.ts`, `queries/contacts.ts`, `queries/conversations.ts`.
- [ ] **Step 5:** Update `queries/settings.ts` — import SpamSettings, CallSettings, TranscriptionSettings, etc.
- [ ] **Step 6:** Update `queries/reports.ts`, `queries/bans.ts`, `queries/audit.ts`, `queries/invites.ts`.
- [ ] **Step 7:** Update `queries/users.ts`, `queries/intakes.ts`, `queries/analytics.ts`.
- [ ] **Step 8:** Run `bun run typecheck` and `bun run build`.
- [ ] **Step 9:** Run `bunx playwright test --project=bootstrap --project=ui --project=api` to verify no regressions.
- [ ] **Step 10:** Commit: `refactor: React Query hooks import types from @shared/schemas`

## Phase C: Route Conversion to OpenAPIHono

Convert route files to `@hono/zod-openapi` declarative pattern. `OpenAPIHono` extends `Hono`, so existing middleware and `.get()/.post()` patterns still work — convert incrementally.

### Reference pattern (report-types.ts):
```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { CreateReportTypeSchema } from '@shared/schemas/report-types'

const routes = new OpenAPIHono<AppEnv>()

const listRoute = createRoute({
  method: 'get', path: '/', tags: ['Reports'],
  summary: 'List report types',
  responses: { 200: { description: '...', content: { 'application/json': { schema: z.object({ reportTypes: z.array(ReportTypeSchema) }) } } } },
})

routes.openapi(listRoute, async (c) => {
  // handler — use c.req.valid('json'), c.req.valid('param')
})
```

### Task C1: Convert high-traffic routes (users, shifts, calls, notes, bans)

**Files:** 5 route files in `src/server/routes/`

For each file:
1. Change `new Hono<AppEnv>()` to `new OpenAPIHono<AppEnv>()`
2. Import `{ OpenAPIHono, createRoute, z }` from `@hono/zod-openapi`
3. Import request schemas from `@shared/schemas/`
4. Define response schemas (can be inline z.object or imported)
5. Convert each `.get()/.post()/.patch()/.delete()` to `createRoute()` + `.openapi()`
6. Use `c.req.valid('json')` for validated bodies, `c.req.valid('param')` for path params
7. Keep all existing middleware (auth, requirePermission, etc.) in the `middleware` array

- [ ] **Step 1:** Convert `shifts.ts` (7 endpoints) — use ShiftSchedule, CreateShiftScheduleSchema, UpdateShiftScheduleSchema.
- [ ] **Step 2:** Convert `bans.ts` (4 endpoints) — use BanEntry, CreateBanSchema.
- [ ] **Step 3:** Convert `notes.ts` (5 endpoints) — use EncryptedNote, CreateNoteSchema.
- [ ] **Step 4:** Convert `calls.ts` (4 endpoints) — use ActiveCall, EncryptedCallRecord.
- [ ] **Step 5:** Convert `users.ts` (6 endpoints) — use Volunteer, CreateVolunteerSchema.
- [ ] **Step 6:** Run `bun run typecheck`, fix response schema mismatches with service return types.
- [ ] **Step 7:** Run tests: `bunx playwright test --project=bootstrap --project=ui --project=api`.
- [ ] **Step 8:** Commit: `feat: convert users/shifts/calls/notes/bans to OpenAPIHono`

### Task C2: Convert admin routes (settings, hubs, audit, analytics)

- [ ] **Step 1:** Convert `settings.ts` (12 endpoints).
- [ ] **Step 2:** Convert `hubs.ts` (8 endpoints).
- [ ] **Step 3:** Convert `audit.ts` (1 endpoint, query params).
- [ ] **Step 4:** Convert `analytics.ts` (3 endpoints, query params).
- [ ] **Step 5:** Typecheck + test + commit: `feat: convert admin routes to OpenAPIHono`

### Task C3: Convert CMS routes (teams, tags, intakes, blasts, contacts, conversations, reports)

- [ ] **Step 1:** Convert `tags.ts` (already has schemas).
- [ ] **Step 2:** Convert `teams.ts` (already has schemas).
- [ ] **Step 3:** Convert `intakes.ts` (already has schemas).
- [ ] **Step 4:** Convert `blasts.ts`.
- [ ] **Step 5:** Convert `contacts.ts` (10 endpoints — largest route file).
- [ ] **Step 6:** Convert `conversations.ts`.
- [ ] **Step 7:** Convert `reports.ts`.
- [ ] **Step 8:** Typecheck + test + commit: `feat: convert CMS routes to OpenAPIHono`

### Task C4: Convert infrastructure routes (auth, config, invites, files, gdpr, etc.)

- [ ] **Step 1:** Convert `config.ts`, `health.ts`, `metrics.ts` (public routes).
- [ ] **Step 2:** Convert `invites.ts`, `gdpr.ts`, `geocoding.ts`.
- [ ] **Step 3:** Convert `files.ts`, `uploads.ts`.
- [ ] **Step 4:** Convert `notifications.ts`, `webrtc.ts`, `provisioning.ts`.
- [ ] **Step 5:** Convert `setup.ts`, `provider-setup.ts`.
- [ ] **Step 6:** Convert `auth.ts` (skip auth-facade.ts — complex IdP bridge).
- [ ] **Step 7:** Typecheck + test + commit: `feat: convert infrastructure routes to OpenAPIHono`

### Task C5: Remove hono-openapi (rhinobase) package

After all routes use `@hono/zod-openapi`, the `hono-openapi` package is unused.

- [ ] **Step 1:** `bun remove hono-openapi @hono/standard-validator @standard-community/standard-json @standard-community/standard-openapi`
- [ ] **Step 2:** Verify no imports of `hono-openapi` remain.
- [ ] **Step 3:** Run `bun run typecheck` and `bun run build`.
- [ ] **Step 4:** Commit: `chore: remove unused hono-openapi package`

## Phase D: Verification

### Task D1: Full test suite + OpenAPI spec review

- [ ] **Step 1:** Run `bunx playwright test` — full suite, all projects.
- [ ] **Step 2:** Start dev server, visit `/api/docs` — verify all routes appear in Scalar docs.
- [ ] **Step 3:** Check `/api/openapi.json` — verify schema names, descriptions, tags are correct.
- [ ] **Step 4:** Run `bun run typecheck` and `bun run build` — clean with no warnings.
- [ ] **Step 5:** Verify no remaining imports of duplicate types from `@shared/types` that should come from schemas.
- [ ] **Step 6:** Update CLAUDE.md if any patterns changed during implementation.
- [ ] **Step 7:** Final commit: `docs: update CLAUDE.md for completed schema migration`
