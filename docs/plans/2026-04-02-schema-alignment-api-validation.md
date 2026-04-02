# Plan: Schema Alignment & API Validation

**Spec:** `docs/specs/2026-04-02-schema-alignment-api-validation.md`
**Date:** 2026-04-02
**Estimated effort:** 2 sessions (~4-6 hours)
**Priority:** High

---

## Phase 1: Auth Facade Zod Validation (4 endpoints)

### Step 1.1: Create Auth Schemas
- [ ] **File:** `src/shared/schemas/auth.ts` (create)
- [ ] `WebAuthnLoginVerifySchema` — `{ assertion: z.unknown(), challengeId: z.string() }`
- [ ] `InviteAcceptSchema` — `{ code: z.string().min(1) }`
- [ ] `DemoLoginSchema` — `{ pubkey: z.string().length(64) }`
- [ ] `WebAuthnRegisterVerifySchema` — `{ attestation: z.unknown(), label: z.string().min(1).max(64), challengeId: z.string() }`
- [ ] Export from `src/shared/schemas/index.ts`

### Step 1.2: Convert Auth Facade to OpenAPI Routes
- [ ] **File:** `src/server/routes/auth-facade.ts`
- [ ] Convert from `new Hono()` to `new OpenAPIHono()`
- [ ] Replace each `app.post('/path', handler)` with `createRoute()` + `.openapi(route, handler)`
- [ ] Use `c.req.valid('json')` instead of `await c.req.json() as T`
- [ ] 4 endpoints to convert (lines 181, 233, 260, 312)

### Step 1.3: Convert Messaging Preferences
- [ ] **File:** `src/server/app.ts:189`
- [ ] Create schema for PATCH `/messaging/preferences` body
- [ ] Move to proper route file or convert inline to createRoute

### Step 1.4: Convert Contacts Import
- [ ] **File:** `src/server/routes/contacts-import.ts`
- [ ] Create schema for batch import body
- [ ] Convert to createRoute pattern

### Step 1.5: Verify
- [ ] `bun run typecheck`
- [ ] `bunx playwright test tests/api/auth-facade.spec.ts`
- [ ] Verify `/api/openapi.json` includes new endpoints
- [ ] Check `/api/docs` shows auth endpoints

---

## Phase 2: Blast Schema Alignment

### Step 2.1: Rewrite Blast Shared Schema
- [ ] **File:** `src/shared/schemas/blasts.ts`
- [ ] Add missing status values: `'scheduled'`, `'cancelled'`
- [ ] Change `channel` to `targetChannels: z.array(z.enum([...]))`
- [ ] Add `scheduledAt`, `error`, `encryptedName`, `encryptedContent` fields
- [ ] Replace individual count fields with `stats` object matching DB JSONB
- [ ] Add `contentEnvelopes` as optional (E2EE)
- [ ] Keep `name`/`content` as optional plaintext fields (for client display after decryption)

### Step 2.2: Update Consumers
- [ ] **File:** `src/client/lib/api.ts` — update blast API functions
- [ ] **File:** `src/client/routes/blasts.tsx` — update UI components
- [ ] **File:** `src/server/routes/blasts.ts` — update route handlers to use new schema

### Step 2.3: Verify
- [ ] `bun run typecheck`
- [ ] `bunx playwright test tests/api/blasts.spec.ts`
- [ ] `bunx playwright test tests/ui/blasts.spec.ts`

---

## Phase 3: CallLeg & Other Field Fixes

### Step 3.1: Fix CallLeg Schema
- [ ] **File:** `src/shared/schemas/calls.ts`
- [ ] Rename `volunteerPubkey` → `userPubkey`
- [ ] Add `type: z.enum(['phone', 'browser']).optional()`
- [ ] Update `phone` → document as decrypted from `encryptedPhone`

### Step 3.2: Fix Custom Field Naming
- [ ] **File:** `src/shared/schemas/settings.ts`
- [ ] Align `type` → `fieldType` or document the mapping

### Step 3.3: Fix Blast Settings Keywords
- [ ] **File:** `src/shared/schemas/blasts.ts`
- [ ] Align `subscribeKeyword`/`unsubscribeKeyword` with DB `optInKeywords`/`optOutKeywords`

### Step 3.4: Add reportTypeId to Conversations
- [ ] **File:** `src/shared/schemas/conversations.ts`
- [ ] Add `reportTypeId: z.string().optional()` to ConversationSchema

### Step 3.5: Verify All
- [ ] `bun run typecheck`
- [ ] `bun run build`
- [ ] Full test suite: `bun run test:all`

---

## Phase 4: Commit & Backlog Update

- [ ] Commit each phase separately for clean git history
- [ ] Update NEXT_BACKLOG.md to reflect completed schema work
