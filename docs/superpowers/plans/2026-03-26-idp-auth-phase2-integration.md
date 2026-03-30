# IdP Auth Phase 2: Integration, Testing & Bootstrapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phase 1's auth foundation production-ready — real Authentik in every environment, proper bootstrapping, permissions fix, and full E2E test coverage.

**Architecture:** Docker Compose cascade (prod base extended by CI/dev). Authentik provisioned via blueprints. Server hard-fails without IdP. All tests run against real Authentik.

**Tech Stack:** Bun, Hono, Authentik 2025.12, Docker Compose, Playwright, `@simplewebauthn/server`

**Spec:** `docs/superpowers/specs/2026-03-26-idp-auth-phase2-integration-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `deploy/docker/authentik-blueprints/llamenos.yaml` | Declarative Authentik provisioning (app, provider, property mapping, service group) |
| `deploy/docker/docker-compose.ci.yml` | CI-specific compose overrides (port mappings, test env vars) |
| `tests/api/auth-facade.spec.ts` | API integration tests for all facade endpoints against real Authentik |

### Modified Files

| File | Change |
|------|--------|
| `deploy/docker/docker-compose.yml` | Add blueprint volume mount (server+worker), AUTHENTIK_BOOTSTRAP_TOKEN, Redis service, postgres-init mount |
| `deploy/docker/docker-compose.dev.yml` | Add Authentik port offset (9100:9000), Redis port, inherit from prod |
| `deploy/docker/postgres-init/01-authentik-db.sql` | Create authentik database on Postgres startup (idempotent) |
| `src/client/lib/auth-facade-client.ts` | Add `enroll()` method |
| `deploy/ansible/templates/docker-compose.j2` | Mirror Redis, blueprint, bootstrap token changes |
| `deploy/docker/.env.example` | Add AUTHENTIK_BOOTSTRAP_TOKEN |
| `.github/workflows/ci.yml` | Replace GH Actions service containers with docker-compose |
| `src/server/server.ts:128-140` | Hard failure if IdP unavailable |
| `src/server/app.ts:75-98` | Pass SettingsService to facade context, null-guard on idpAdapter |
| `src/server/routes/auth-facade.ts:70-103,315-347` | Fix token/refresh auth (cookie-only), fix permissions resolution, add POST /auth/enroll |
| `src/server/routes/auth.ts:13-47` | Bootstrap creates Authentik user, returns real nsecSecret |
| `src/server/idp/authentik-adapter.ts:253-263` | Fix session deletion API (list then delete individually) |
| `src/client/routes/onboarding.tsx` | Call /auth/enroll for real nsecSecret |
| `src/client/components/setup/AdminBootstrap.tsx` | Receive real nsecSecret from bootstrap |
| `src/client/routes/login.tsx` | Recovery calls /auth/enroll |
| `src/client/components/demo-account-picker.tsx` | Call /auth/enroll |
| `tests/helpers/authed-request.ts` | Enroll test users in Authentik |
| `tests/ui/webauthn-passkeys.spec.ts` | Full facade flow with real Authentik |

---

## Task Dependency Graph

```
Task 1 (Authentik blueprint + Docker infra) ─────────────────────────┐
Task 2 (Server hard-fail + null guard + bridge fix) ← depends on 1 ──┤
Task 3 (Token refresh bug fix) ────────────────────────────────────────┤
Task 4 (Permissions resolution fix) ───────────────────────────────────┤
Task 5 (Enrollment endpoint + bootstrap IdP) ← depends on 2 ──────────┤
Task 6 (Client flows: real nsecSecret) ← depends on 5 ────────────────┤
Task 7 (Authentik session deletion fix) ───────────────────────────────┤
Task 8 (CI docker-compose) ← depends on 1 ────────────────────────────┤
Task 9 (Test helpers: enroll in Authentik) ← depends on 5, 8 ─────────┤
Task 10 (API integration tests) ← depends on all above ───────────────┤
Task 11 (E2E test updates) ← depends on 9, 10 ────────────────────────┘
```

Task 1 and 7 can run in parallel. **Tasks 3 and 4 must be serialized** — both modify `auth-facade.ts`. Task 8 is independent of server code.

---

## Task 1: Authentik Blueprint + Docker Infrastructure

**Files:**
- Create: `deploy/docker/authentik-blueprints/llamenos.yaml`
- Modify: `deploy/docker/docker-compose.yml`
- Modify: `deploy/docker/docker-compose.dev.yml`

**Docs:** Look up Authentik 2025.12 blueprint documentation via context7 or web search before writing the blueprint YAML. Verify: model names, YAML tags (`!Find`, `!KeyOf`), and whether Redis is still required.

- [ ] **Step 1: Research Authentik 2025.12 blueprint format**

Use context7 MCP or web search to verify:
- Blueprint YAML schema for version 1
- Correct model names for OAuth2 provider, scope mapping, application, group
- Whether `!Find` and `!KeyOf` tags are still supported
- Whether Authentik 2025.12 requires Redis or not

- [ ] **Step 2: Create the blueprint file**

Create `deploy/docker/authentik-blueprints/llamenos.yaml` with entries for:
1. Service account group (`authentik_core.group`)
2. Custom property mapping exposing `nsec_secret` attribute (`authentik_providers_oauth2.scopemapping`)
3. OAuth2 provider linked to the property mapping (`authentik_providers_oauth2.oauth2provider`)
4. Application linked to the provider (`authentik_core.application`)

- [ ] **Step 3: Create Postgres init script**

Create `deploy/docker/postgres-init/01-authentik-db.sql`:

```sql
-- Create authentik database if it doesn't exist (idempotent)
SELECT 'CREATE DATABASE authentik'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'authentik')\gexec
```

Verify the postgres service in docker-compose.yml mounts `./postgres-init:/docker-entrypoint-initdb.d:ro`.

- [ ] **Step 4: Add Redis service to docker-compose.yml**

Authentik requires Redis for its worker process. Add unconditionally:

```yaml
redis:
  image: redis:7-alpine
  restart: unless-stopped
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
```

Add to BOTH `authentik-server` and `authentik-worker` environments:
```yaml
AUTHENTIK_REDIS__HOST: redis
```

Add `depends_on: redis: condition: service_healthy` to both authentik services.

- [ ] **Step 5: Update docker-compose.yml — blueprint + bootstrap token**

Add to `authentik-server` service environment (insert into existing env block, don't replace):
```yaml
AUTHENTIK_BOOTSTRAP_TOKEN: ${AUTHENTIK_BOOTSTRAP_TOKEN}
```

Add to BOTH `authentik-server` and `authentik-worker` volumes:
```yaml
- ./authentik-blueprints:/blueprints/custom
```

Add to `app` service environment:
```yaml
AUTHENTIK_API_TOKEN: ${AUTHENTIK_BOOTSTRAP_TOKEN}
```

- [ ] **Step 6: Update Ansible template**

Mirror all changes in `deploy/ansible/templates/docker-compose.j2`:
- Redis service with Jinja2 vars
- Blueprint volume mount on both authentik services
- AUTHENTIK_BOOTSTRAP_TOKEN on authentik-server
- AUTHENTIK_REDIS__HOST on both authentik services

- [ ] **Step 7: Update docker-compose.dev.yml**

Add port offsets for local dev:
```yaml
authentik-server:
  ports:
    - "9100:9000"
redis:
  ports:
    - "6380:6379"
```

Update `bun run dev:docker` script in package.json to include `authentik-server authentik-worker redis` in the service list.

- [ ] **Step 8: Add AUTHENTIK_BOOTSTRAP_TOKEN to env files**

In `.env.dev.defaults`:
```
AUTHENTIK_BOOTSTRAP_TOKEN=dev-bootstrap-token-not-for-production
```

In `.env.example`:
```
AUTHENTIK_BOOTSTRAP_TOKEN=<generate with: openssl rand -hex 32>
```

- [ ] **Step 9: Test locally**

```bash
cd deploy/docker && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
# Wait for Authentik to be healthy
docker compose logs authentik-server | tail -20
# Verify blueprint was applied
curl -s -H "Authorization: Bearer dev-bootstrap-token-not-for-production" http://localhost:9100/api/v3/core/applications/ | head
```

- [ ] **Step 10: Commit**

```bash
git add deploy/
git commit -m "feat: add Authentik blueprint, Redis, postgres-init, and Docker infrastructure"
```

---

## Task 2: Server Hard-Fail + Null Guard + Bridge Fix

**Files:**
- Modify: `src/server/server.ts:128-140`
- Modify: `src/server/app.ts:75-98`

- [ ] **Step 1: Make server.ts hard-fail**

Replace the try/catch warn pattern at lines 128-140 with:

```typescript
// Initialize IdP adapter (required — server cannot operate without it)
const { createIdPAdapter } = await import('./idp/index')
const idpAdapter = await createIdPAdapter()
const { setIdPAdapter } = await import('./app')
setIdPAdapter(idpAdapter)
console.log(`[llamenos] IdP adapter initialized (${process.env.IDP_ADAPTER || 'authentik'})`)
```

No try/catch — if this fails, the process crashes. Docker restarts it.

- [ ] **Step 2: Add null guard to bridge middleware**

In `src/server/app.ts`, the bridge middleware at line 81 currently does:
```typescript
if (_idpAdapter) {
  ctx.set('idpAdapter', _idpAdapter)
}
```

Replace with:
```typescript
if (!_idpAdapter) {
  return c.json({ error: 'IdP service not initialized' }, 503)
}
ctx.set('idpAdapter', _idpAdapter)
```

- [ ] **Step 3: Pass SettingsService to facade context**

In the same bridge middleware, add:
```typescript
ctx.set('settings', services.settings)
```

This is needed for Task 4 (permissions resolution).

- [ ] **Step 4: Run typecheck**

Run: `cd /home/rikki/projects/llamenos-hotline-idp-auth && bun run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/server/server.ts src/server/app.ts
git commit -m "feat: hard-fail on missing IdP, add null guard and settings bridge"
```

---

## Task 3: Token Refresh Bug Fix

**Files:**
- Modify: `src/server/routes/auth-facade.ts:315-347`

- [ ] **Step 1: Read the current token refresh implementation**

Read `src/server/routes/auth-facade.ts` lines 240-350 to understand the current middleware chain.

- [ ] **Step 2: Remove jwtAuth middleware from /token/refresh**

The existing handler at lines 315-347 already reads the refresh cookie, verifies the refresh JWT, and returns a new access token. The ONLY problem is line 245 which applies `jwtAuth` middleware to this route, blocking access when the access token has expired.

**Fix:** Remove the `jwtAuth` middleware registration for `/token/refresh` at line 245. The handler itself already authenticates via the refresh cookie — no access JWT needed.

Do NOT rewrite the handler — it's already correct. Just remove the middleware gatekeeping.

- [ ] **Step 3: Run existing auth-facade tests**

Run: `cd /home/rikki/projects/llamenos-hotline-idp-auth && bun test src/server/routes/auth-facade.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/auth-facade.ts
git commit -m "fix: authenticate token refresh via cookie only, not expired access JWT"
```

---

## Task 4: Permissions Resolution Fix

**Files:**
- Modify: `src/server/routes/auth-facade.ts:90-103`

- [ ] **Step 1: Read the current resolveVolunteerPermissions**

Lines 90-103 of `auth-facade.ts`. Currently returns raw role IDs.

- [ ] **Step 2: Fix to resolve actual permissions**

Replace with:
```typescript
async function resolveVolunteerPermissions(
  pubkey: string,
  identity: IdentityService,
  settings: SettingsService
): Promise<{ volunteer: Volunteer; permissions: string[] }> {
  const volunteer = await identity.getVolunteer(pubkey)
  if (!volunteer) throw new Error('Volunteer not found')

  const allRoles = await settings.getRoles()
  const permissions = resolvePermissions(volunteer.roles, allRoles)
  return { volunteer, permissions: [...permissions] }
}
```

Import `resolvePermissions` from `src/shared/permissions.ts` (check exact export name).

- [ ] **Step 3: Update all callers in auth-facade.ts**

Every place that calls `resolveVolunteerPermissions()` needs to pass the `settings` context variable. Update the function calls in login-verify, token-refresh, and register flows.

- [ ] **Step 4: Update the AuthFacadeEnv type**

Add `settings: SettingsService` to the `AuthFacadeEnv.Variables` type so TypeScript knows about it.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd /home/rikki/projects/llamenos-hotline-idp-auth && bun test src/server/routes/auth-facade.test.ts && bun run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/auth-facade.ts
git commit -m "fix: resolve actual permissions in JWT instead of raw role IDs"
```

---

## Task 5: Enrollment Endpoint + Bootstrap IdP Integration

**Files:**
- Modify: `src/server/routes/auth-facade.ts`
- Modify: `src/server/routes/auth.ts:13-47`

- [ ] **Step 1: Add POST /auth/enroll endpoint**

In `auth-facade.ts`, add an authenticated endpoint:

```typescript
// POST /auth/enroll — create user in Authentik, return real nsecSecret
authFacade.post('/enroll', jwtAuth, async (c) => {
  const permissions = c.get('permissions') as string[]
  if (!permissions.includes('volunteers:create') && !permissions.includes('*')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const { pubkey } = await c.req.json<{ pubkey: string }>()
  if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) {
    return c.json({ error: 'Invalid pubkey' }, 400)
  }

  const idpAdapter = c.get('idpAdapter')

  // Check if user already exists
  const existing = await idpAdapter.getUser(pubkey)
  if (existing) {
    // User already enrolled — just return their nsecSecret
    const nsecSecret = await idpAdapter.getNsecSecret(pubkey)
    return c.json({ nsecSecret: Buffer.from(nsecSecret).toString('hex') })
  }

  // Create new user
  await idpAdapter.createUser(pubkey)
  const nsecSecret = await idpAdapter.getNsecSecret(pubkey)
  return c.json({ nsecSecret: Buffer.from(nsecSecret).toString('hex') })
})
```

- [ ] **Step 2: Update bootstrap endpoint to create Authentik user**

In `src/server/routes/auth.ts`, the POST /bootstrap handler (lines 13-47) needs IdP access. Import `getIdPAdapter` from app.ts:

```typescript
import { getIdPAdapter } from '../app'
```

After creating the volunteer in Postgres (line 41), add:

```typescript
// Create user in Authentik (required — server hard-fails without IdP)
const idpAdapter = getIdPAdapter()
if (!idpAdapter) {
  return c.json({ error: 'IdP service not available' }, 503)
}
await idpAdapter.createUser(body.pubkey)
const nsecSecret = await idpAdapter.getNsecSecret(body.pubkey)
const nsecSecretHex = Buffer.from(nsecSecret).toString('hex')

return c.json({ ok: true, roles: result.roles, nsecSecret: nsecSecretHex })
```

No try/catch — if Authentik enrollment fails, the bootstrap fails. This is consistent with the hard-fail philosophy. The admin must fix the infrastructure before proceeding.

- [ ] **Step 3: Run typecheck**

Run: `cd /home/rikki/projects/llamenos-hotline-idp-auth && bun run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/auth-facade.ts src/server/routes/auth.ts
git commit -m "feat: add enrollment endpoint, bootstrap creates Authentik user"
```

---

## Task 6: Client Flows — Real nsecSecret

**Files:**
- Modify: `src/client/routes/onboarding.tsx`
- Modify: `src/client/components/setup/AdminBootstrap.tsx`
- Modify: `src/client/routes/login.tsx`
- Modify: `src/client/components/demo-account-picker.tsx`
- Modify: `src/client/lib/auth-facade-client.ts`

- [ ] **Step 1: Add enroll method to auth facade client**

In `src/client/lib/auth-facade-client.ts`, add:

```typescript
async enroll(pubkey: string): Promise<{ nsecSecret: Uint8Array }> {
  const res = await this.authedFetch('/auth/enroll', {
    method: 'POST',
    body: JSON.stringify({ pubkey }),
  })
  if (!res.ok) throw new AuthFacadeError('Enrollment failed', res.status)
  const data = await res.json()
  return { nsecSecret: hexToBytes(data.nsecSecret) }
}
```

- [ ] **Step 2: Update AdminBootstrap.tsx**

Replace synthetic value with real nsecSecret from bootstrap response:

```typescript
// After bootstrap API call, use the returned nsecSecret
const response = await bootstrapAdmin(...)
const realNsecSecret = hexToBytes(response.nsecSecret)
await keyManager.importKey(nsec, confirmedPin, pubkey, realNsecSecret, prfOutput, issuerUrl)
```

Remove `syntheticIdpValue('bootstrap')` usage.

- [ ] **Step 3: Update onboarding.tsx**

After WebAuthn registration and invite acceptance, call `/auth/enroll`:

```typescript
const { nsecSecret } = await authFacadeClient.enroll(pubkey)
await keyManager.importKey(nsecHex, pin, pubkey, nsecSecret, prfOutput, issuerUrl)
```

Remove `syntheticIdpValue('onboarding')` usage.

- [ ] **Step 4: Update login.tsx (recovery flow)**

Recovery flow calls `/auth/enroll` to re-create the Authentik user:

```typescript
const { nsecSecret } = await authFacadeClient.enroll(pubkey)
await keyManager.importKey(nsecHex, pin, pubkey, nsecSecret, prfOutput, issuerUrl)
```

Remove `syntheticIdpValue('recovery')` usage.

- [ ] **Step 5: Update demo-account-picker.tsx**

```typescript
const { nsecSecret } = await authFacadeClient.enroll(pubkey)
await keyManager.importKey(nsecHex, pin, pubkey, nsecSecret, undefined, issuerUrl)
```

Remove `syntheticIdpValue('demo')` usage.

- [ ] **Step 6: Clean up synthetic helpers**

In `src/client/lib/key-store-v2.ts`, remove the `SYNTHETIC_ISSUERS` entries for `bootstrap`, `onboarding`, `recovery`, `demo`. Keep only `device-link`.

Update `src/client/lib/key-manager.ts` `unlock()` — the synthetic detection and auto-rotation logic stays but only triggers for `device-link`.

- [ ] **Step 7: Run typecheck + build**

Run: `cd /home/rikki/projects/llamenos-hotline-idp-auth && bun run typecheck && bun run build`

- [ ] **Step 8: Commit**

```bash
git add src/client/
git commit -m "feat: use real IdP nsecSecret in all flows except device linking"
```

---

## Task 7: Authentik Session Deletion Fix

**Files:**
- Modify: `src/server/idp/authentik-adapter.ts:253-263`

- [ ] **Step 1: Research Authentik session deletion API**

Use context7 or web search to verify the correct approach for deleting user sessions in Authentik 2025.12. Check if bulk DELETE via query param is supported or if individual deletion is required.

- [ ] **Step 2: Fix deleteAuthentikSessions**

If bulk DELETE is not supported, change to list-then-delete:

```typescript
private async deleteAuthentikSessions(pubkey: string): Promise<void> {
  const user = await this.findUser(pubkey)
  if (!user) return

  // List all sessions for this user
  const listRes = await this.apiCall('GET', `/api/v3/core/authenticated-sessions/?user=${user.pk}`)
  if (!listRes.ok) return
  const data = await listRes.json()

  // Delete each session individually
  for (const session of data.results ?? []) {
    await this.apiCall('DELETE', `/api/v3/core/authenticated-sessions/${session.uuid}/`)
  }
}
```

- [ ] **Step 3: Run adapter tests**

Run: `cd /home/rikki/projects/llamenos-hotline-idp-auth && bun test src/server/idp/authentik-adapter.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/server/idp/authentik-adapter.ts
git commit -m "fix: list-then-delete Authentik sessions instead of bulk DELETE"
```

---

## Task 8: CI Docker Compose

**Files:**
- Create: `deploy/docker/docker-compose.ci.yml`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Create docker-compose.ci.yml**

```yaml
# CI-specific overrides — extends production docker-compose.yml
# Port mappings for GH Actions runner (services accessible via localhost)

services:
  postgres:
    ports:
      - "5432:5432"

  authentik-server:
    ports:
      - "9100:9000"

  minio:
    ports:
      - "9000:9000"

  strfry:
    ports:
      - "7777:7777"

  redis:
    ports:
      - "6379:6379"
```

- [ ] **Step 2: Update CI workflow**

Replace the GH Actions service containers in `api-tests` and `e2e-tests` jobs with docker-compose:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: ./.github/actions/setup-bun

  - name: Start backing services
    run: >
      docker compose
      -f deploy/docker/docker-compose.yml
      -f deploy/docker/docker-compose.ci.yml
      up -d postgres redis authentik-server authentik-worker minio strfry
    env:
      PG_PASSWORD: llamenos
      AUTHENTIK_SECRET_KEY: ci-test-secret
      AUTHENTIK_BOOTSTRAP_TOKEN: ci-bootstrap-token
      # ... other required env vars

  - name: Wait for Authentik
    run: |
      for i in $(seq 1 60); do
        curl -sf http://localhost:9100/-/health/ready/ && break
        sleep 5
      done

  - name: Build frontend
    run: bun run build

  - name: Start server
    env:
      DATABASE_URL: postgresql://llamenos:llamenos@localhost:5432/llamenos
      AUTHENTIK_URL: http://localhost:9100
      AUTHENTIK_API_TOKEN: ci-bootstrap-token
      JWT_SECRET: ${{ env.TEST_JWT_SECRET }}
      # ... other env vars
    run: |
      bun run start > /tmp/server.log 2>&1 &
      for i in $(seq 1 30); do
        curl -sf http://localhost:3000/api/health/ready && break
        sleep 2
      done
```

Remove the GH Actions `services:` blocks from api-tests and e2e-tests jobs entirely.

Keep the `unit-tests` job using GH Actions service containers for Postgres only (unit tests don't need Authentik — the auth-related unit tests mock at the adapter level).

- [ ] **Step 3: Commit**

```bash
git add deploy/docker/docker-compose.ci.yml .github/workflows/ci.yml
git commit -m "ci: use docker-compose for Authentik in API and E2E tests"
```

---

## Task 9: Test Helpers — Enroll in Authentik

**Files:**
- Modify: `tests/helpers/authed-request.ts`

- [ ] **Step 1: Read the current test setup flow**

Read `tests/helpers/authed-request.ts` and the Playwright `setup` project to understand how test users are currently created.

- [ ] **Step 2: Add Authentik enrollment to test user creation**

After creating a volunteer in Postgres (via the admin authed request), call `/api/auth/enroll` to create them in Authentik:

```typescript
// After creating the volunteer via API:
await adminRequest.post('/api/auth/enroll', {
  data: { pubkey: volunteerPubkey }
})
```

This ensures every test user exists in Authentik and can get a real `nsecSecret` via `/auth/userinfo`.

The admin test user itself also needs to be enrolled. This may need to happen during the bootstrap phase of the setup project.

- [ ] **Step 3: Run existing API tests to verify they still pass**

Run: `cd /home/rikki/projects/llamenos-hotline-idp-auth && bun test src/server/`

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "feat: enroll test users in Authentik during setup"
```

---

## Task 10: API Integration Tests

**Files:**
- Create: `tests/api/auth-facade.spec.ts`

**Depends on:** All previous tasks (Authentik running, enrollment working, permissions fixed)

- [ ] **Step 1: Write facade integration tests**

Create `tests/api/auth-facade.spec.ts` with Playwright API testing (no browser). Tests against the running server + real Authentik:

```typescript
import { test, expect } from '@playwright/test'

test.describe('Auth Facade', () => {
  // Bootstrap creates Authentik user + returns real nsecSecret
  test('bootstrap returns nsecSecret from Authentik', ...)

  // WebAuthn login via virtual authenticator returns JWT
  test('WebAuthn login returns JWT', ...)

  // JWT authenticates subsequent API calls
  test('JWT token authenticates API requests', ...)

  // Token refresh via httpOnly cookie returns new JWT
  test('token refresh works with cookie only (no access JWT)', ...)

  // GET /auth/userinfo returns real nsecSecret from Authentik
  test('userinfo returns real nsecSecret', ...)

  // POST /auth/enroll creates user in Authentik
  test('enrollment creates Authentik user and returns nsecSecret', ...)

  // Session revocation invalidates refresh
  test('session revocation invalidates refresh cookie', ...)

  // Admin re-enrollment wipes credentials
  test('admin re-enrollment revokes sessions and wipes credentials', ...)

  // Rate limiting blocks excessive login attempts
  test('rate limiting on login endpoints', ...)

  // Full onboarding flow
  test('full onboarding: invite -> accept -> enroll -> register -> login', ...)

  // Error cases
  test('IdP temporarily unavailable returns clear error', ...)
  test('concurrent enrollment of same pubkey is idempotent', ...)
  test('nsecSecret rotation lifecycle', ...)
  test('bootstrap called twice returns 403', ...)
  test('JWT from wrong secret is rejected', ...)
  test('volunteer deactivation affects Authentik user', ...)
})
```

Each test should be self-contained — create its own test users, clean up after.

- [ ] **Step 2: Run tests against local Authentik**

Requires `bun run dev:docker` to have Authentik running.

Run: `cd /home/rikki/projects/llamenos-hotline-idp-auth && bunx playwright test tests/api/auth-facade.spec.ts`

- [ ] **Step 3: Fix any failures, iterate**

- [ ] **Step 4: Commit**

```bash
git add tests/api/auth-facade.spec.ts
git commit -m "feat: add auth facade API integration tests against real Authentik"
```

---

## Task 11: E2E Test Updates

**Files:**
- Modify: `tests/ui/webauthn-passkeys.spec.ts`

- [ ] **Step 1: Update WebAuthn passkey tests**

Update to exercise the full facade flow with real Authentik:
1. Register passkey via `/api/auth/webauthn/register-options` + `/register-verify`
2. Login via `/api/auth/webauthn/login-options` + `/login-verify`
3. Verify JWT returned (not just session token)
4. Use JWT for authenticated API calls
5. GET `/api/auth/userinfo` returns real nsecSecret from Authentik
6. Verify the nsecSecret is a valid 32-byte hex value

- [ ] **Step 2: Run full E2E suite**

Run: `cd /home/rikki/projects/llamenos-hotline-idp-auth && bunx playwright test --project=setup --project=api --project=ui`

- [ ] **Step 3: Fix any failures from auth migration**

Other E2E tests may break if they depend on the old auth flow. Fix systematically.

- [ ] **Step 4: Run typecheck + build**

Run: `cd /home/rikki/projects/llamenos-hotline-idp-auth && bun run typecheck && bun run build`

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "feat: update E2E tests for full auth facade flow with real Authentik"
```
