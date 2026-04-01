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

- [x] **Step 1:** Add missing schemas to `settings.ts` — WebAuthnSettings, RetentionSettings, GeocodingConfig, SetupState, EnabledChannels. Check current types.ts definitions (lines 488-575) for the exact shape.
- [x] **Step 2:** Add missing schemas to `blasts.ts` — BlastContent, BlastStats, BlastSettings. Check types.ts lines 461-510.
- [x] **Step 3:** Add NotePayload and KeyEnvelope schemas to `records.ts`. Check types.ts lines 11-15, 323-326.
- [x] **Step 4:** Create `files.ts` schema for FileRecord, EncryptedFileMetadata, UploadInit. Check types.ts lines 264-320.
- [x] **Step 5:** Create `common.ts` schema for shared enums: ContactType, RiskLevel, LocationPrecision, CallPreference, MessageDeliveryStatus, MessagingChannelType, ChannelType, CustomFieldContext. Check types.ts for definitions.
- [x] **Step 6:** Update `src/shared/schemas/index.ts` to re-export new files.
- [x] **Step 7:** Run `bun run typecheck` to verify all schemas compile.
- [x] **Step 8:** Commit: `feat: add remaining entity schemas for single source of truth`

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

- [x] **Step 1:** Replace messaging config types (SMSConfig, WhatsAppConfig, SignalConfig, RCSConfig, MessagingConfig) with re-exports from `@shared/schemas/providers`.
- [x] **Step 2:** Replace blast types (Blast, BlastContent, BlastStats, Subscriber, SubscriberChannel) with re-exports from `@shared/schemas/blasts`.
- [x] **Step 3:** RecipientEnvelope/KeyEnvelope: KEPT in types.ts — uses branded Ciphertext which schemas can't express. Schema equivalents exist for API validation.
- [x] **Step 4:** Hub replaced with re-export. CustomFieldDefinition KEPT in types.ts (branded Ciphertext fields). RetentionSettings replaced.
- [x] **Step 5:** Replace ReportType, CreateReportTypeInput, UpdateReportTypeInput with re-exports from `@shared/schemas/report-types`.
- [x] **Step 6:** Replace ContactType, RiskLevel enums with re-exports from `@shared/schemas/common`. Also replaced: LocationPrecision, CallPreference, MessageDeliveryStatus, MessagingChannelType, ChannelType, CustomFieldContext.
- [x] **Step 7:** Run `bun run typecheck` — clean.
- [x] **Step 8:** Run `bun run build` — clean.
- [x] **Step 9:** Commit: `refactor: replace duplicate types in types.ts with schema re-exports`

## Phase B: API Layer Migration

### Task B1: Update api.ts to import types from schemas

**Files:**
- Modify: `src/client/lib/api.ts` — change import sources from `@shared/types` to `@shared/schemas`

There are 16 imports from `@shared/types` in api.ts. After Phase A, many of these types are re-exports from schemas. Change imports to point directly at schemas for types that have schemas. Keep types.ts imports for internal types (TelephonyProviderDraft, OAuthState, etc.).

- [x] **Step 1:** Changed schema-available type imports to `@shared/schemas`: TelephonyProviderConfig, BlastContent, BlastSettings, GeocodingConfig, EnabledChannels, SetupState, Hub, RetentionSettings.
- [x] **Step 2:** Kept branded-Ciphertext types in `@shared/types`: RecipientEnvelope, KeyEnvelope, CustomFieldDefinition, Blast, Subscriber, MessagingConfig, ReportType, etc.
- [x] **Step 3:** Skipped return type annotations (existing types sufficient, will add during Phase C route conversion).
- [x] **Step 4:** `bun run typecheck` clean.
- [x] **Step 5:** Committed: `refactor: api.ts imports types from @shared/schemas`

### Task B2: Update React Query hooks to use schema types

**Files:**
- Modify: all 18 query files in `src/client/lib/queries/` that import from `@/lib/api`

For each query file:
1. Import types from `@shared/schemas` instead of from `@/lib/api`
2. Ensure `queryOptions` generic parameter uses the schema type
3. Keep API function imports from `@/lib/api` (the functions, not the types)

- [x] **Steps 1-7:** Updated 4 query files (audit, blasts, hubs, settings) to import from `@shared/schemas` or `@shared/types`. Other query types kept in `@/lib/api` due to Ciphertext branding or schema shape mismatches.
- [x] **Step 8:** `bun run typecheck` clean.
- [ ] **Step 9:** Run `bunx playwright test --project=bootstrap --project=ui --project=api` to verify no regressions. (Deferred to Phase D)
- [x] **Step 10:** Committed: `refactor: React Query hooks import types from @shared/schemas`

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

- [x] **Step 1:** Convert `shifts.ts` (7 endpoints) — inline schemas matching service layer (volunteerPubkeys→userPubkeys gap noted).
- [x] **Step 2:** Convert `bans.ts` (4 endpoints) — used CreateBanSchema from shared schemas.
- [x] **Step 3:** Convert `notes.ts` (6 endpoints incl replies) — inline schemas for Ciphertext fields.
- [x] **Step 4:** Convert `calls.ts` (9 endpoints + 1 standard Hono for binary audio) — recording endpoint kept as standard `.get()`.
- [x] **Step 5:** Convert `users.ts` (5 endpoints) — inline schemas, `.passthrough()` for complex projections.
- [x] **Step 6:** `bun run typecheck` clean.
- [ ] **Step 7:** Tests deferred to Phase D.
- [x] **Step 8:** Committed: `feat: convert users/shifts/calls/notes/bans to OpenAPIHono`

### Task C2: Convert admin routes (settings, hubs, audit, analytics)

- [x] **Step 1:** Convert `settings.ts` (30 endpoints).
- [x] **Step 2:** Convert `hubs.ts` (16 endpoints).
- [x] **Step 3:** Convert `audit.ts` (1 endpoint).
- [x] **Step 4:** Convert `analytics.ts` (3 endpoints).
- [x] **Step 5:** Typecheck clean. Committed: `feat: convert admin routes to OpenAPIHono`

### Task C3: Convert CMS routes (teams, tags, intakes, blasts, contacts, conversations, reports)

- [x] **Step 1:** Convert `tags.ts` (4 endpoints).
- [x] **Step 2:** Convert `teams.ts` (10 endpoints).
- [x] **Step 3:** Convert `intakes.ts` (4 endpoints).
- [x] **Step 4:** Convert `blasts.ts` (12 endpoints).
- [x] **Step 5:** Convert `contacts.ts` (19 endpoints).
- [x] **Step 6:** Convert `conversations.ts` (8 endpoints).
- [x] **Step 7:** Convert `reports.ts` (9 endpoints).
- [x] **Step 8:** Typecheck clean. Committed: `feat: convert CMS routes to OpenAPIHono`

### Task C4: Convert infrastructure routes (auth, config, invites, files, gdpr, etc.)

- [x] **Step 1:** Convert `config.ts` (2), `health.ts` (3), `metrics.ts` (1 kept standard — text/plain).
- [x] **Step 2:** Convert `invites.ts` (6), `gdpr.ts` (5 + 2 standard for file downloads), `geocoding.ts` (7).
- [x] **Step 3:** Convert `files.ts` (3 + 1 standard for binary), `uploads.ts` (4 + 1 standard for binary chunks).
- [x] **Step 4:** Convert `notifications.ts` (3), `webrtc.ts` (2), `provisioning.ts` (3).
- [x] **Step 5:** Convert `setup.ts` (5), `provider-setup.ts` (13 + 1 standard for OAuth redirect).
- [x] **Step 6:** Convert `auth.ts` (6). Skipped auth-facade.ts.
- [x] **Step 7:** Typecheck clean. Committed: `feat: convert infrastructure routes to OpenAPIHono`

### Task C5: Remove hono-openapi (rhinobase) package

After all routes use `@hono/zod-openapi`, the `hono-openapi` package is unused.

- [x] **Step 1:** `bun remove hono-openapi @hono/standard-validator @standard-community/standard-json @standard-community/standard-openapi`
- [x] **Step 2:** Verified no imports of `hono-openapi` remain.
- [x] **Step 3:** Typecheck + build clean.
- [x] **Step 4:** Committed: `chore: remove unused hono-openapi package`

## Phase D: Verification

### Task D1: Full test suite + OpenAPI spec review

- [x] **Step 1:** Full test suite: unit 513/513, API 395/397 (2 pre-existing), UI 463/463. Zero migration regressions.
- [x] **Step 2:** `/api/docs` serves Scalar HTML. 233 paths across 29 tags.
- [x] **Step 3:** `/api/openapi.json` verified — all converted routes present with correct tags.
- [x] **Step 4:** `bun run typecheck` and `bun run build` — both clean.
- [x] **Step 5:** Verified: no stale hono-openapi imports, 4 intentionally unconverted files (telephony webhooks, contacts-import, signal-registration, dev-only).
- [x] **Step 6:** Updated CLAUDE.md: OpenAPIHono in tech stack, schema architecture, external schemas, directory structure.
- [x] **Step 7:** Committed: `feat: external schemas for third-party webhooks + CLAUDE.md update`
