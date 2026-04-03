# Plan: Code Organization & Refactoring

**Spec:** `docs/superpowers/specs/2026-04-02-code-organization-refactoring.md`
**Date:** 2026-04-02
**Estimated effort:** 3-4 sessions (~8-12 hours)
**Priority:** Medium

---

## Phase 1: Split api.ts (Highest Impact)

### Step 1.1: Create api/client.ts Base
- [ ] Extract `request()` helper, `getAuthToken()`, `BASE_URL`, and fetch wrapper to `src/client/lib/api/client.ts`
- [ ] Export shared utilities for all domain modules

### Step 1.2: Split Domain Modules
- [ ] Create `src/client/lib/api/auth.ts` — auth functions
- [ ] Create `src/client/lib/api/users.ts` — user CRUD + profile
- [ ] Create `src/client/lib/api/calls.ts` — call operations + analytics
- [ ] Create `src/client/lib/api/contacts.ts` — contact CRUD + relationships
- [ ] Create `src/client/lib/api/conversations.ts` — messaging
- [ ] Create `src/client/lib/api/reports.ts` — reports + files
- [ ] Create `src/client/lib/api/blasts.ts` — blasts + subscribers
- [ ] Create `src/client/lib/api/hubs.ts` — hub management
- [ ] Create `src/client/lib/api/settings.ts` — all settings
- [ ] Create `src/client/lib/api/telephony.ts` — provider config
- [ ] Create `src/client/lib/api/invites.ts` — invitations
- [ ] Create `src/client/lib/api/files.ts` — file upload/download

### Step 1.3: Create Barrel Export
- [ ] Create `src/client/lib/api/index.ts` — re-export all functions
- [ ] Update `src/client/lib/api.ts` to re-export from `api/index.ts` (backwards compat)

### Step 1.4: Verify
- [ ] `bun run typecheck`
- [ ] `bun run build`
- [ ] All imports resolve correctly

---

## Phase 2: Split settings.ts Service

### Step 2.1: Extract Domain Services
- [ ] Create `src/server/services/spam-settings.ts`
- [ ] Create `src/server/services/call-settings.ts`
- [ ] Create `src/server/services/ivr-settings.ts`
- [ ] Create `src/server/services/provider-config.ts`
- [ ] Create `src/server/services/messaging-config.ts`
- [ ] Create `src/server/services/hub-management.ts`
- [ ] Create `src/server/services/role-management.ts`
- [ ] Create `src/server/services/geocoding-config.ts`

### Step 2.2: Update Service Registry
- [ ] Update service initialization in `src/server/lib/services.ts` or wherever services are created
- [ ] Each new service gets its own DB connection and cache instances
- [ ] Shared caching patterns (TTLCache) stay consistent

### Step 2.3: Update Route Imports
- [ ] All routes importing from `services.settings` update to import from specific services
- [ ] Example: `services.settings.getSpamSettings()` → `services.spamSettings.get()`

### Step 2.4: Verify
- [ ] `bun run typecheck`
- [ ] `bun run build`
- [ ] Run all API E2E tests

---

## Phase 3: Split contacts.ts Route & types.ts

### Step 3.1: Create Contacts Route Modules
- [ ] Create `src/server/routes/contacts/` directory
- [ ] Move core CRUD to `contacts/index.ts`
- [ ] Move relationships to `contacts/relationships.ts`
- [ ] Move bulk operations to `contacts/bulk.ts`
- [ ] Move notifications/call-linking to `contacts/outreach.ts`
- [ ] Create barrel at `contacts/index.ts` that merges all sub-routers

### Step 3.2: Split Server Types
- [ ] Create `src/server/types/` directory
- [ ] Split by domain: auth, calls, messaging, scheduling, settings
- [ ] Barrel re-export from `src/server/types/index.ts`
- [ ] Update all `import from '../types'` to `from '../types/index'` (should be transparent)

### Step 3.3: Verify
- [ ] `bun run typecheck`
- [ ] `bun run build`
- [ ] Full test suite

---

## Phase 4: decryptHubField Migration

### Step 4.1: Migrate Component-Level Calls
- [ ] For each component file with `decryptHubField`:
  - Move decryption into the corresponding React Query `queryFn`
  - Remove `decryptHubField` import from component
  - Ensure query cache returns already-decrypted data

### Step 4.2: Verify Each Migration
- [ ] After each file, verify the page still renders correctly
- [ ] Hub-encrypted data (names, labels) must display properly

### Step 4.3: Remove hub-field-crypto.ts
- [ ] Once all consumers migrated, delete `src/client/lib/hub-field-crypto.ts`
- [ ] Verify no imports remain

---

## Phase 5: Console.log Cleanup

### Step 5.1: Replace with Structured Logger
- [ ] Create minimal `src/client/lib/logger.ts`: `createLogger(namespace)` → `{ log, warn, error }`
- [ ] Controlled by `import.meta.env.DEV` or localStorage flag
- [ ] Replace all 17 console.log statements
- [ ] Or: simply remove them if they're not needed in production

### Step 5.2: Verify
- [ ] `bun run build` — no console.log in production bundle (or gated behind DEV)

---

## Commit Strategy

- One commit per phase (clean, reviewable diffs)
- Each commit must pass `bun run typecheck && bun run build`
- No functional changes — purely organizational
