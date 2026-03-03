# Epic 233: Worker Backend Test Suite

## Goal

Build a comprehensive test suite for the Cloudflare Worker backend (`apps/worker/`), starting from zero tests. Use **Vitest** with a phased approach: pure function unit tests → service layer with DO mocks → route handler integration tests → Durable Object logic tests. Include BDD-style API contract tests for the HTTP surface.

## Context

Current state:
- **Zero test files** in `apps/worker/`
- **~6,500 LOC** across 7 Durable Objects, 23 route modules, 14 lib modules, 5 middleware
- **834 LOC** of pure functions (crypto, auth, helpers, SSRF guard, push encryption, Nostr publisher)
- **4,020 LOC** in Durable Objects (IdentityDO, SettingsDO, RecordsDO, ShiftManagerDO, CallRouterDO, ConversationDO, BlastDO)
- All existing E2E tests (Playwright) test the full stack via browser — no isolated backend unit tests
- Vitest is not yet installed in the project

## Why Vitest

- First-class ESM support (Workers are ESM)
- Cloudflare Workers integration via `@cloudflare/vitest-pool-workers` (Miniflare v3 pool)
- Fast execution, watch mode, coverage reporting
- Compatible with existing `bun` package manager

## Deliverables

### Phase 1: Infrastructure Setup

#### 1.1 Install Dependencies

```bash
bun add -d vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types miniflare
```

#### 1.2 Create Vitest Config

**`apps/worker/vitest.config.ts`**:
```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
        },
      },
    },
  },
})
```

**`apps/worker/vitest.unit.config.ts`** (for pure function tests — no Workers pool):
```typescript
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    alias: {
      '@worker': fileURLToPath(new URL('./', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../packages/shared/', import.meta.url)),
    },
  },
})
```

**Important**: Aliases are resolved relative to the config file location (`apps/worker/`), so `@worker` points to `.` and `@shared` points to `../../packages/shared/`.

#### 1.3 Add Scripts to Root `package.json`

```json
{
  "scripts": {
    "test:worker": "vitest run --config apps/worker/vitest.unit.config.ts",
    "test:worker:watch": "vitest --config apps/worker/vitest.unit.config.ts",
    "test:worker:integration": "vitest run --config apps/worker/vitest.config.ts",
    "test:worker:all": "vitest run --config apps/worker/vitest.unit.config.ts && vitest run --config apps/worker/vitest.config.ts"
  }
}
```

#### 1.4 CI Integration

Add `worker-tests` job to `.github/workflows/ci.yml`:
```yaml
worker-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@<SHA>
    - uses: oven-sh/setup-bun@<SHA>
      with:
        bun-version: '1.3'
    - run: bun install --frozen-lockfile
    - run: bun run test:worker
```

Update `ci-status` gate job to depend on `worker-tests`.

### Phase 2: Pure Function Unit Tests (~100 tests)

No mocks needed — pure input/output functions.

#### `apps/worker/tests/unit/crypto.test.ts` (~30 tests)

Test all exports from `lib/crypto.ts`:

```typescript
describe('hashPhone', () => {
  test('returns consistent HMAC-SHA256 hex for same input', ...)
  test('different phones produce different hashes', ...)
  test('different secrets produce different hashes', ...)
  test('handles E.164 format with + prefix', ...)
  test('handles empty phone gracefully', ...)
})

describe('hashIP', () => {
  test('returns 96-bit truncated HMAC-SHA256', ...)
  test('handles IPv4 and IPv6', ...)
  test('consistent for same IP + secret', ...)
})

describe('encryptMessageForStorage', () => {
  test('encrypts plaintext and produces envelopes for each reader', ...)
  test('different readers get different envelopes', ...)
  test('envelope count matches reader count', ...)
  test('encrypted content is not plaintext', ...)
  test('uses LABEL_MESSAGE domain separation', ...)
  test('handles single reader', ...)
  test('handles empty plaintext', ...)
})

describe('encryptCallRecordForStorage', () => {
  test('encrypts metadata for admin pubkeys', ...)
  test('uses LABEL_CALL_META domain separation', ...)
  test('produces valid hex output', ...)
})

describe('hashAuditEntry', () => {
  test('produces SHA-256 hash of entry JSON', ...)
  test('hash changes when entry content changes', ...)
  test('hash chain: includes previousEntryHash', ...)
  test('first entry has empty previousEntryHash', ...)
})
```

#### `apps/worker/tests/unit/auth.test.ts` (~15 tests)

```typescript
describe('parseAuthHeader', () => {
  test('parses valid Bearer JSON token', ...)
  test('returns null for missing header', ...)
  test('returns null for non-Bearer scheme', ...)
  test('returns null for invalid JSON', ...)
})

describe('parseSessionHeader', () => {
  test('extracts Session token', ...)
  test('returns null for missing header', ...)
})

describe('validateToken', () => {
  test('accepts token within 5-minute window', ...)
  test('rejects expired token', ...)
  test('rejects future token beyond window', ...)
})

describe('verifyAuthToken', () => {
  test('verifies valid Schnorr signature', ...)
  test('rejects invalid signature', ...)
  test('verifies method+path binding', ...)
  test('rejects token with wrong path', ...)
  test('rejects token with wrong method', ...)
})
```

#### `apps/worker/tests/unit/helpers.test.ts` (~12 tests)

```typescript
describe('isValidE164', () => {
  test('accepts valid E.164 numbers', ...)
  test('rejects numbers without +', ...)
  test('rejects too-short numbers', ...)
  test('rejects too-long numbers', ...)
  test('rejects non-numeric characters', ...)
})

describe('extractPathParam', () => {
  test('extracts parameter from path', ...)
  test('prevents path traversal with /', ...)
  test('handles URL-encoded characters', ...)
})

describe('uint8ArrayToBase64URL', () => {
  test('encodes empty array', ...)
  test('encodes known test vector', ...)
  test('produces URL-safe output (no +/=)', ...)
})
```

#### `apps/worker/tests/unit/ssrf-guard.test.ts` (~20 tests)

```typescript
describe('isInternalIPv4', () => {
  test('blocks 10.0.0.0/8', ...)
  test('blocks 172.16.0.0/12', ...)
  test('blocks 192.168.0.0/16', ...)
  test('blocks 127.0.0.0/8 loopback', ...)
  test('blocks 169.254.0.0/16 link-local', ...)
  test('blocks 100.64.0.0/10 CGNAT', ...)
  test('allows valid public IPs', ...)
})

describe('isInternalAddress', () => {
  test('blocks IPv6 loopback ::1', ...)
  test('blocks IPv4-mapped IPv6 ::ffff:10.0.0.1', ...)
  test('blocks link-local fe80::', ...)
  test('allows valid public IPv6', ...)
})

describe('validateExternalUrl', () => {
  test('accepts valid HTTPS URLs', ...)
  test('rejects internal IP URLs', ...)
  test('rejects non-HTTPS URLs', ...)
  test('rejects malformed URLs', ...)
  test('provides descriptive error messages', ...)
})
```

#### `apps/worker/tests/unit/push-encryption.test.ts` (~8 tests)

```typescript
describe('encryptWakePayload', () => {
  test('produces valid hex output', ...)
  test('uses LABEL_PUSH_WAKE domain separation', ...)
  test('different payloads produce different ciphertext', ...)
  test('output changes with different device key', ...)
})

describe('encryptFullPayload', () => {
  test('produces valid hex output', ...)
  test('uses LABEL_PUSH_FULL domain separation', ...)
  test('output changes with different volunteer key', ...)
  test('handles JSON payload correctly', ...)
})
```

#### `apps/worker/tests/unit/nostr-publisher.test.ts` (~8 tests)

```typescript
describe('deriveServerKeypair', () => {
  test('derives deterministic keypair from secret', ...)
  test('same secret produces same keypair', ...)
  test('different secrets produce different keypairs', ...)
  test('pubkey is 64-char hex (x-only)', ...)
})

describe('signServerEvent', () => {
  test('produces valid signed Nostr event', ...)
  test('event has correct kind', ...)
  test('signature verifies against pubkey', ...)
  test('event has valid created_at timestamp', ...)
})
```

#### `apps/worker/tests/unit/do-router.test.ts` (~10 tests)

```typescript
describe('DORouter', () => {
  test('matches GET routes', ...)
  test('matches POST routes', ...)
  test('extracts path parameters', ...)
  test('returns 404 for unmatched routes', ...)
  test('rejects path traversal in params', ...)
  test('matches correct method', ...)
  test('handles multiple route registrations', ...)
  test('handles nested path patterns', ...)
  test('all() matches any method', ...)
  test('passes params to handler', ...)
})
```

#### `apps/worker/tests/unit/permissions.test.ts` (~7 tests)

Tests the actual permission logic from `packages/shared/permissions.ts` (the `permissionGranted` function), not the Hono middleware wrapper in `middleware/permission-guard.ts` which is a one-line delegation:

```typescript
import { permissionGranted } from '@shared/permissions'

describe('permissionGranted', () => {
  test('grants exact permission match', ...)
  test('grants wildcard * permission', ...)
  test('grants domain wildcard (notes:*)', ...)
  test('denies missing permission', ...)
  test('denies with empty permissions list', ...)
  test('handles multiple required permissions', ...)
  test('union of permissions from multiple roles', ...)
})
```

### Phase 3: Service Layer Tests with DO Mocks (~50 tests)

Create a lightweight DO mock that mimics `DurableObjectStub.fetch()`:

#### `apps/worker/tests/helpers/do-mock.ts`

```typescript
/**
 * Mock DurableObjectStub that intercepts fetch() calls
 * and returns preconfigured responses.
 */
export class MockDOStub {
  private responses = new Map<string, Response>()

  mockRoute(method: string, path: string, response: unknown, status = 200) {
    const key = `${method}:${path}`
    this.responses.set(key, new Response(JSON.stringify(response), { status }))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const key = `${request.method}:${url.pathname}`
    return this.responses.get(key) ?? new Response('Not Found', { status: 404 })
  }
}

export function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    IDENTITY_DO: { get: () => new MockDOStub() },
    SETTINGS_DO: { get: () => new MockDOStub() },
    RECORDS_DO: { get: () => new MockDOStub() },
    // ... other bindings
    ...overrides,
  } as unknown as Env
}
```

#### `apps/worker/tests/service/auth-middleware.test.ts` (~12 tests)

```typescript
describe('authenticateRequest', () => {
  test('authenticates via valid session token', ...)
  test('authenticates via valid Schnorr signature', ...)
  test('rejects expired session', ...)
  test('rejects invalid Schnorr signature', ...)
  test('returns null for missing auth header', ...)
  test('prefers session token over Schnorr', ...)
  test('sets permissions from volunteer roles', ...)
})
```

#### `apps/worker/tests/service/cors-middleware.test.ts` (~6 tests)

```typescript
describe('CORS middleware', () => {
  test('allows localhost in development', ...)
  test('reflects HTTPS origin in production', ...)
  test('handles OPTIONS preflight', ...)
  test('sets Vary: Origin header', ...)
})
```

#### `apps/worker/tests/service/audit.test.ts` (~8 tests)

```typescript
describe('audit service', () => {
  test('extracts IP from CF-Connecting-IP header', ...)
  test('hashes IP with HMAC secret', ...)
  test('includes country from CF-IPCountry', ...)
  test('includes User-Agent', ...)
  test('sends audit entry to RecordsDO', ...)
})
```

#### `apps/worker/tests/service/hub-middleware.test.ts` (~8 tests)

**Important**: Each service test must pre-configure `MockDOStub` responses before exercising the middleware. Example setup:

```typescript
const settingsStub = new MockDOStub()
settingsStub.mockRoute('GET', '/settings/hub/hub-1', { id: 'hub-1', name: 'Test Hub', roles: [...] })
const env = createMockEnv({ SETTINGS_DO: { get: () => settingsStub } })
```

```typescript
describe('hub context', () => {
  test('extracts hubId from route param', ...)
  test('resolves hub-scoped permissions', ...)
  test('rejects invalid hubId', ...)
  test('sets hub context variables', ...)
})
```

### Phase 4: BDD-Style API Contract Tests (~80 tests)

Create Gherkin feature files for the backend HTTP API surface, using a `@backend` tag. These live in `packages/test-specs/features/backend/` and test the Worker API contract.

**Critical**: The Playwright BDD config globs `packages/test-specs/features/**/*.feature` which would match backend features. Since `playwright-bdd`'s `bddgen` will attempt to generate test files for all matched features and fail on missing step definitions, update `playwright.config.ts` to exclude backend features:

```typescript
// In playwright.config.ts defineBddConfig:
tags: '@desktop and not @backend',
```

This single-line change ensures `bddgen` skips all `@backend`-tagged scenarios.

#### Feature Files

**`packages/test-specs/features/backend/auth-api.feature`** (12 scenarios):
```gherkin
@backend
Feature: Authentication API
  As a client application
  I want to authenticate with the Worker backend
  So that I can access protected resources

  Scenario: Login with valid Schnorr signature
    Given a registered volunteer with a valid keypair
    When I send a login request with a valid Schnorr signature
    Then I should receive a 200 response with a session token

  Scenario: Login with expired token timestamp
    Given a registered volunteer with a valid keypair
    When I send a login request with an expired timestamp
    Then I should receive a 401 unauthorized response

  Scenario: Bootstrap creates first admin
    Given no admin exists
    When I send a bootstrap request with a valid pubkey and signature
    Then I should receive a 200 response
    And the volunteer should have "Super Admin" role

  # ... 9 more scenarios covering WebAuthn, session revocation, rate limiting
```

**`packages/test-specs/features/backend/volunteers-api.feature`** (10 scenarios):
```gherkin
@backend
Feature: Volunteers API
  As an admin
  I want to manage volunteers
  So that I can control who has access to the hotline

  Scenario: List volunteers
    Given I am authenticated as an admin
    When I GET /api/volunteers
    Then I should receive a list of volunteers

  Scenario: Create volunteer via invite
    Given I am authenticated as an admin
    When I POST /api/invites with a valid invite code
    Then the invite should be created

  Scenario: Volunteer cannot list other volunteers
    Given I am authenticated as a volunteer
    When I GET /api/volunteers
    Then I should receive a 403 forbidden response

  # ... 7 more scenarios
```

**`packages/test-specs/features/backend/notes-api.feature`** (10 scenarios):
```gherkin
@backend
Feature: Notes API
  Scenario: Create encrypted note
  Scenario: List notes with pagination
  Scenario: Filter notes by author
  Scenario: Add reply to note
  Scenario: List note replies
  # ... 5 more
```

**`packages/test-specs/features/backend/shifts-api.feature`** (8 scenarios):
```gherkin
@backend
Feature: Shifts API
  Scenario: Create shift schedule
  Scenario: Get current on-shift volunteers
  Scenario: Get my shift status
  Scenario: Delete shift
  # ... 4 more
```

**`packages/test-specs/features/backend/calls-api.feature`** (10 scenarios):
```gherkin
@backend
Feature: Calls API
  Scenario: Record incoming call
  Scenario: Answer call updates state
  Scenario: End call stores encrypted record
  Scenario: Get call history with pagination
  Scenario: Report spam on call
  # ... 5 more
```

**`packages/test-specs/features/backend/conversations-api.feature`** (10 scenarios):
```gherkin
@backend
Feature: Conversations API
  Scenario: Create conversation from incoming message
  Scenario: List conversations with filters
  Scenario: Assign conversation to volunteer
  Scenario: Auto-assign balances load
  Scenario: Send outbound message
  # ... 5 more
```

**`packages/test-specs/features/backend/bans-api.feature`** (6 scenarios):
```gherkin
@backend
Feature: Bans API
  Scenario: Add ban by phone number
  Scenario: Bulk import bans
  Scenario: Check if phone is banned
  Scenario: Remove ban
  Scenario: List bans
  Scenario: Ban check during incoming call
```

**`packages/test-specs/features/backend/settings-api.feature`** (8 scenarios):
```gherkin
@backend
Feature: Settings API
  Scenario: Get spam settings
  Scenario: Update spam settings
  Scenario: Get custom fields
  Scenario: Create custom field
  Scenario: Validate custom field constraints
  Scenario: Get telephony provider config
  Scenario: Update telephony provider config
  Scenario: Rate limiter respects configured limits
```

#### Backend Step Definitions

These are Vitest tests that implement the Gherkin scenarios using the Worker's Hono app directly (no HTTP — call `app.fetch()` with mock requests):

**`apps/worker/tests/contract/step-helpers.ts`**:
```typescript
import app from '../../app'
import { createMockEnv } from '../helpers/do-mock'

export async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  const env = createMockEnv()
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  return app.fetch(request, env)
}
```

### Phase 5: Durable Object Logic Tests (~60 tests)

Test DO internal logic using the `@cloudflare/vitest-pool-workers` pool, which provides real Miniflare runtime:

#### `apps/worker/tests/integration/identity-do.test.ts` (~15 tests)

```typescript
import { env } from 'cloudflare:test'

describe('IdentityDO', () => {
  test('creates volunteer with pubkey and role', ...)
  test('rejects duplicate pubkey', ...)
  test('validates invite code before redemption', ...)
  test('session token lifecycle: create → validate → revoke', ...)
  test('WebAuthn credential storage and retrieval', ...)
  test('device provisioning room lifecycle', ...)
  test('bootstrap rejects if admin already exists', ...)
  // ... 8 more
})
```

#### `apps/worker/tests/integration/records-do.test.ts` (~12 tests)

```typescript
describe('RecordsDO', () => {
  test('audit log hash chain integrity', ...)
  test('audit log pagination', ...)
  test('audit log filtering by actor/event/date', ...)
  test('note CRUD operations', ...)
  test('note reply threading', ...)
  test('ban check by phone hash', ...)
  test('bulk ban import', ...)
  test('contact indexing by hash', ...)
  // ... 4 more
})
```

#### Similar files for SettingsDO, ShiftManagerDO, CallRouterDO, ConversationDO, BlastDO (~33 tests total)

## File Changes

### New files:

**Infrastructure (3 files)**:
- `apps/worker/vitest.config.ts`
- `apps/worker/vitest.unit.config.ts`
- `apps/worker/tests/helpers/do-mock.ts`

**Unit tests (8 files, ~100 tests)**:
- `apps/worker/tests/unit/crypto.test.ts`
- `apps/worker/tests/unit/auth.test.ts`
- `apps/worker/tests/unit/helpers.test.ts`
- `apps/worker/tests/unit/ssrf-guard.test.ts`
- `apps/worker/tests/unit/push-encryption.test.ts`
- `apps/worker/tests/unit/nostr-publisher.test.ts`
- `apps/worker/tests/unit/do-router.test.ts`
- `apps/worker/tests/unit/permission-guard.test.ts`

**Service tests (4 files, ~50 tests)**:
- `apps/worker/tests/service/auth-middleware.test.ts`
- `apps/worker/tests/service/cors-middleware.test.ts`
- `apps/worker/tests/service/audit.test.ts`
- `apps/worker/tests/service/hub-middleware.test.ts`

**BDD contract features (8 files, ~80 scenarios)**:
- `packages/test-specs/features/backend/auth-api.feature`
- `packages/test-specs/features/backend/volunteers-api.feature`
- `packages/test-specs/features/backend/notes-api.feature`
- `packages/test-specs/features/backend/shifts-api.feature`
- `packages/test-specs/features/backend/calls-api.feature`
- `packages/test-specs/features/backend/conversations-api.feature`
- `packages/test-specs/features/backend/bans-api.feature`
- `packages/test-specs/features/backend/settings-api.feature`

**Contract test implementations (8 files)**:
- `apps/worker/tests/contract/auth-api.test.ts`
- `apps/worker/tests/contract/volunteers-api.test.ts`
- `apps/worker/tests/contract/notes-api.test.ts`
- `apps/worker/tests/contract/shifts-api.test.ts`
- `apps/worker/tests/contract/calls-api.test.ts`
- `apps/worker/tests/contract/conversations-api.test.ts`
- `apps/worker/tests/contract/bans-api.test.ts`
- `apps/worker/tests/contract/settings-api.test.ts`

**Integration tests (7 files, ~60 tests)**:
- `apps/worker/tests/integration/identity-do.test.ts`
- `apps/worker/tests/integration/settings-do.test.ts`
- `apps/worker/tests/integration/records-do.test.ts`
- `apps/worker/tests/integration/shift-manager.test.ts`
- `apps/worker/tests/integration/call-router.test.ts`
- `apps/worker/tests/integration/conversation-do.test.ts`
- `apps/worker/tests/integration/blast-do.test.ts`

### Modified files:
- `package.json` (add test:worker scripts)
- `.github/workflows/ci.yml` (add worker-tests job)
- `apps/worker/package.json` (add vitest devDependency)
- `playwright.config.ts` (add `not @backend` to BDD tag filter to exclude backend features from Playwright)

## Verification

```bash
# Phase 1: Pure function tests (no Workers runtime needed)
bun run test:worker

# Phase 2-3: With Workers pool
bun run test:worker:integration

# Full suite
bun run test:worker:all

# CI gate
bun run test:worker && bun run test:worker:integration
```

## Metrics

| Metric | Before | After |
|--------|--------|-------|
| Worker test files | 0 | ~38 |
| Worker unit tests | 0 | ~100 |
| Worker service tests | 0 | ~50 |
| Worker contract tests | 0 | ~80 |
| Worker DO integration tests | 0 | ~60 |
| **Total Worker tests** | **0** | **~290** |
| Backend BDD feature files | 0 | 8 |
| Backend BDD scenarios | 0 | ~80 |

## Dependencies

- **Independent**: Can start immediately (no dependency on Epics 231/232)
- **Parallel**: Can run alongside Epics 231-232
- **New devDeps**: `vitest`, `@cloudflare/vitest-pool-workers`, `miniflare`
