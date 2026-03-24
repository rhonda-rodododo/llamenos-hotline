# Test Suite Restructuring Design

**Date:** 2026-03-23
**Status:** Draft
**Scope:** 3-phase restructuring of test architecture

## Problem

All tests currently run through Playwright, even when they don't need a browser. Pure API endpoint tests spin up Chromium. Tests that only need HTTP requests use `page.evaluate` as a workaround for authenticated `fetch` calls. Unit tests live in a `__tests__/` directory instead of next to their source files. There is no way to run backend tests independently of the frontend.

This causes:
- Unnecessary overhead (browser launch for HTTP-only tests)
- Copy-pasted `apiCall` helpers across ~16 test files using `page.evaluate` for Schnorr auth
- No clear convention for where to add new tests
- Cannot run backend-only test suites in CI

## Design

### Three Test Suites

| Suite | Runner | Location | What it tests | Command |
|-------|--------|----------|---------------|---------|
| **Unit** | `bun test` | Colocated `*.test.ts` next to source | Pure functions, classes, logic | `bun test` |
| **API integration** | Playwright (no browser) | `tests/api/*.spec.ts` | HTTP endpoints against running server | `bunx playwright test --project=api` |
| **UI E2E** | Playwright (Chromium) | `tests/ui/*.spec.ts` | Full browser user flows | `bunx playwright test --project=ui` |

The existing **bridge** project remains for `asterisk-auto-config.spec.ts` (subprocess integration that needs neither browser nor running server).

**Decision guide for new tests:**
- Testing a pure function or class? → colocated `.test.ts` with `bun:test`
- Testing an API endpoint's request/response behavior? → `tests/api/`
- Testing what a user sees and clicks? → `tests/ui/`

### The `authedRequest` Helper

Core enabler for headless API tests. Replaces the `page.evaluate(apiCall)` pattern.

**Location:** `tests/helpers/authed-request.ts`

**How it works:**
1. Takes a Playwright `APIRequestContext` + Nostr secret key (Uint8Array)
2. Imports `createAuthToken` directly from `src/client/lib/crypto.ts` — single source of truth
3. For each request, generates a fresh Schnorr signature bound to `{method}:{path}`
4. Sets `Authorization: Bearer <json>` header with `{ pubkey, timestamp, token }`

**Interface:**
```typescript
import type { APIRequestContext } from '@playwright/test'

interface AuthedRequest {
  get(path: string, opts?: RequestOpts): Promise<APIResponse>
  post(path: string, data?: unknown, opts?: RequestOpts): Promise<APIResponse>
  put(path: string, data?: unknown, opts?: RequestOpts): Promise<APIResponse>
  patch(path: string, data?: unknown, opts?: RequestOpts): Promise<APIResponse>
  delete(path: string, opts?: RequestOpts): Promise<APIResponse>
}

function createAuthedRequest(
  request: APIRequestContext,
  secretKey: Uint8Array
): AuthedRequest
```

**Why this works headlessly:**
- Server auth checks: pubkey exists in DB, timestamp within ±5 min, valid Schnorr signature over `llamenos:auth:{pubkey}:{timestamp}:{method}:{path}`
- No CORS issues — Playwright's `request` fixture doesn't send an `Origin` header
- No session/cookie state needed — each request is independently signed
- `@noble/curves` and `nostr-tools` work identically in Node/Bun

### Playwright Config

```typescript
projects: [
  { name: "setup", testMatch: /global-setup\.ts/ },

  {
    name: "api",
    testDir: "./tests/api",
    use: { /* no device — request fixture only */ },
    dependencies: ["setup"],
  },

  {
    name: "ui",
    testDir: "./tests/ui",
    use: { ...devices["Desktop Chrome"] },
    testIgnore: /bootstrap\.spec\.ts/,
    dependencies: ["setup"],
  },

  {
    name: "bootstrap",
    testDir: "./tests/ui",
    use: { ...devices["Desktop Chrome"] },
    testMatch: /bootstrap\.spec\.ts/,
    dependencies: ["ui"],
  },

  {
    name: "mobile",
    testDir: "./tests/ui",
    use: { ...devices["Pixel 7"] },
    testMatch: /responsive\.spec\.ts/,
    dependencies: ["setup"],
  },

  {
    name: "bridge",
    testMatch: /asterisk-.*\.spec\.ts/,
  },
]
```

### Package Scripts

```json
"test":       "bunx playwright test",
"test:unit":  "bun test src/",
"test:api":   "bunx playwright test --project=api",
"test:ui":    "bunx playwright test --project=ui",
"test:all":   "bun test src/ && bunx playwright test"
```

## Phase 1: Infrastructure + Convention

Create the foundation. Independently shippable.

### Deliverables

1. **Create `tests/helpers/authed-request.ts`** — headless Schnorr auth helper
2. **Restructure `playwright.config.ts`** — add `api`/`ui` projects as designed above
3. **Create `tests/api/` and `tests/ui/` directories**
4. **Migrate 9 unit tests to colocated `.test.ts` files:**

| From | To | Rewrite needed? |
|------|----|----------------|
| `src/server/__tests__/crypto-labels.test.ts` | `src/shared/crypto-labels.test.ts` | No (already bun:test) |
| `src/server/__tests__/custom-fields.test.ts` | `src/shared/custom-fields.test.ts` | No |
| `src/server/__tests__/audit-chain.test.ts` | `src/server/services/records.test.ts` | No |
| `src/server/__tests__/webauthn-counter.test.ts` | `src/server/services/identity.test.ts` | No |
| `src/server/__tests__/rate-limiter.test.ts` | `src/server/services/settings-rate-limiter.test.ts` | No |
| `src/server/__tests__/hub-key-envelopes.test.ts` | `src/server/services/settings-hub-keys.test.ts` | No |
| `tests/credential-encryption.spec.ts` | `src/server/lib/crypto.test.ts` | Yes — Playwright → bun:test |
| `tests/provider-health.spec.ts` | `src/server/services/provider-health.test.ts` | Yes — Playwright → bun:test |
| `tests/provider-capabilities.spec.ts` | `src/server/telephony/provider-capabilities.test.ts` | Yes — Playwright → bun:test |

5. **Delete `src/server/__tests__/` directory**
6. **Update `package.json` scripts**
7. **Update `CLAUDE.md` testing guidance**

### Verification

- `bun test` discovers and passes all colocated unit tests
- `bunx playwright test --project=api` runs (empty suite initially, or with one smoke test)
- `bunx playwright test --project=ui` runs all existing browser tests (temporarily from old location until phase 2)
- No regressions

## Phase 2: File Reorganization

Move all existing Playwright spec files into `tests/ui/` or `tests/api/`. Pure mechanical moves.

### Moves to `tests/api/` (pure `request`, no browser)

- `health-config.spec.ts`
- `simulation-telephony.spec.ts`
- `simulation-messaging.spec.ts`
- `signal-auto-registration.spec.ts`

### Split files

- `voice-captcha.spec.ts` — 5 API tests → `tests/api/voice-captcha.spec.ts`, 1 UI test → `tests/ui/voice-captcha.spec.ts`

### Moves to `tests/ui/` (all remaining browser tests)

All ~43 remaining spec files move to `tests/ui/`:

`smoke.spec.ts`, `admin-flow.spec.ts`, `auth-guards.spec.ts`, `audit-log.spec.ts`, `ban-management.spec.ts`, `blast-sending.spec.ts`, `blasts.spec.ts`, `bootstrap.spec.ts`, `call-detail.spec.ts`, `call-flow.spec.ts`, `call-recording.spec.ts`, `call-spam.spec.ts`, `capture-screenshots.spec.ts`, `client-transcription.spec.ts`, `contacts.spec.ts`, `conversations.spec.ts`, `custom-fields.spec.ts`, `dashboard-analytics.spec.ts`, `demo-mode.spec.ts`, `device-linking.spec.ts`, `e2ee-notes.spec.ts`, `epic-24-27.spec.ts`, `file-field.spec.ts`, `file-upload.spec.ts`, `form-validation.spec.ts`, `gdpr.spec.ts`, `geocoding.spec.ts`, `help.spec.ts`, `hub-access-control.spec.ts`, `hub-membership.spec.ts`, `i18n.spec.ts`, `invite-delivery.spec.ts`, `invite-onboarding.spec.ts`, `login-restore.spec.ts`, `messaging-epics.spec.ts`, `multi-hub.spec.ts`, `notes-crud.spec.ts`, `notes-custom-fields.spec.ts`, `nostr-relay.spec.ts`, `notification-pwa.spec.ts`, `panic-wipe.spec.ts`, `pin-challenge.spec.ts`, `profile-settings.spec.ts`, `provider-oauth.spec.ts`, `pwa-offline.spec.ts`, `rcs-channel.spec.ts`, `reports.spec.ts`, `report-types.spec.ts`, `responsive.spec.ts`, `roles.spec.ts`, `security-hardening.spec.ts`, `setup-wizard.spec.ts`, `setup-wizard-provider.spec.ts`, `shift-management.spec.ts`, `telephony-provider.spec.ts`, `theme.spec.ts`, `voice-captcha.spec.ts` (UI portion), `volunteer-flow.spec.ts`, `volunteer-pii.spec.ts`, `voicemail-webhook.spec.ts`, `webauthn.spec.ts`, `webauthn-passkeys.spec.ts`, `webrtc-settings.spec.ts`

### Shared files that stay at `tests/` root

- `tests/helpers/` — shared by both api and ui
- `tests/pages/` — UI page objects (used by ui only, but fine at root)
- `tests/global-setup.ts` — shared setup
- `tests/test-ids.ts` — shared constants
- `tests/api-helpers.ts` — shared API setup helpers

### Update relative imports

All moved files need import path updates for helpers, test-ids, pages, etc. Paths change from `./helpers` to `../helpers` (one level deeper).

### Verification

- All tests pass in new locations
- `--project=api` runs only API tests
- `--project=ui` runs only UI tests
- No duplicate test execution

## Phase 3: API Test Rewrites

Convert tests that use `page.evaluate(apiCall)` to headless `authedRequest`. This is the high-impact phase — ~133 tests move out of the browser.

### Fully convertible files (all tests are API-via-evaluate, zero UI)

Move from `tests/ui/` → `tests/api/` after rewriting:

| File | Test count | Notes |
|------|-----------|-------|
| `file-upload.spec.ts` | 12 | Upload init/chunks/complete via evaluate |
| `e2ee-notes.spec.ts` | 7 | Crypto via `window.__llamenos_test_crypto` — needs crypto imports server-side |
| `hub-membership.spec.ts` | 4 | Hub CRUD + member operations |
| `security-hardening.spec.ts` | 10 | API security checks |
| `volunteer-pii.spec.ts` | 12 | PII masking enforcement |

### Mixed files to split

Extract API tests → `tests/api/`, keep UI tests → `tests/ui/`:

| File | API tests → api | UI tests → ui |
|------|----------------|---------------|
| `roles.spec.ts` | 23 (CRUD, permissions) | 7 (role dropdowns) |
| `messaging-epics.spec.ts` | 22 (message API) | 8 (conversation UI) |
| `multi-hub.spec.ts` | 7 (hub CRUD) | 4 (switcher UI) |
| `blasts.spec.ts` | 6 (blast API) | 6 (access control UI) |
| `blast-sending.spec.ts` | 7 (send API) | 3 (compose UI) |
| `contacts.spec.ts` | 4 (contact API) | 1 (contacts page) |
| `hub-access-control.spec.ts` | 4 (access API) | 5 (toggle UI) |
| `voicemail-webhook.spec.ts` | 2 (webhook API) | 2 (voicemail flag UI) |

### Files that stay in `tests/ui/` (browser-dependent)

- `webauthn.spec.ts` — CDP virtual authenticator
- `webauthn-passkeys.spec.ts` — CDP
- `nostr-relay.spec.ts` — WebSocket + `page.route` for relay blocking
- `call-flow.spec.ts` — DOM interaction for note composition
- `call-spam.spec.ts` — already uses `request` directly, mixed with UI assertions
- `invite-delivery.spec.ts` — mostly request-based, minimal UI
- `provider-oauth.spec.ts` — uses `page.route` for mock OAuth

### Cleanup

- Remove duplicated `apiCall` / `injectAuthedFetch` helpers from individual test files
- All API tests use the shared `createAuthedRequest` helper

### Verification

- Same test coverage — no tests lost
- API suite runs significantly faster (no browser overhead)
- Mixed files clearly separated by concern

## CLAUDE.md Testing Guidance (Updated)

```markdown
## Testing

Three test suites with distinct purposes:

- **Unit tests** (`bun test`): Colocated `*.test.ts` files next to source.
  Pure logic, no server needed. Use `bun:test` imports.
- **API integration tests** (`bunx playwright test --project=api`):
  Tests in `tests/api/`. HTTP requests against running server, no browser.
  Use `authedRequest` helper for authenticated endpoints.
- **UI E2E tests** (`bunx playwright test --project=ui`):
  Tests in `tests/ui/`. Full browser interaction via Playwright.

Decision guide:
- Testing a pure function or class? → colocated `.test.ts` with `bun:test`
- Testing an API endpoint's behavior? → `tests/api/`
- Testing what a user sees and clicks? → `tests/ui/`

Run the appropriate suite during development:
- `bun test` for unit changes
- `bunx playwright test --project=api` for backend changes
- Full suite before committing
```
