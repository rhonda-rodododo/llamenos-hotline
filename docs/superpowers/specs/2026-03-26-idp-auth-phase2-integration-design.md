# IdP Auth Hardening Phase 2: Integration, Testing & Bootstrapping

**Date:** 2026-03-26
**Status:** Draft
**Scope:** Make Phase 1's auth foundation production-ready with real Authentik integration, full test coverage, and proper bootstrapping.
**Depends on:** `docs/superpowers/specs/2026-03-25-idp-auth-hardening-design.md` (Phase 1)

## Problem

Phase 1 built the cryptographic foundation: multi-factor KEK, Web Worker isolation, JWT auth, IdP adapter interface, Authentik adapter implementation. But a gap analysis revealed:

1. **Facade routes crash** when Authentik is unavailable — 6+ endpoints call `idpAdapter.method()` without the adapter being initialized
2. **No integration tests** exercise the full auth flow (WebAuthn -> JWT -> IdP value -> KEK unlock) against a real IdP
3. **Onboarding doesn't create Authentik users** — the `nsecSecret` fetch fails because no user exists in the IdP
4. **Permissions resolution is broken** — JWT contains role IDs instead of resolved permission strings
5. **Synthetic IdP values** are used in 5 flows where real values should be available (only device linking truly needs synthetic)
6. **CI doesn't run Authentik** — GH Actions service containers proved unreliable for Authentik
7. **Bootstrap flow** doesn't provision the first admin in Authentik

## Solution

Every environment runs real Authentik. No mocks, no test adapters, no graceful degradation. The server hard-fails if the IdP is unavailable. Authentik is provisioned declaratively via blueprints.

## Docker Compose Cascade

Single source of truth with environment-specific overrides:

```
docker-compose.yml           <- Production base
  |- Authentik server + worker
  |- Blueprint volume mount
  |- Postgres init script (creates authentik DB)
  |- App depends_on authentik-server: service_healthy
  |
  +- docker-compose.ci.yml   <- CI overrides (extends prod)
  |    Port mappings for GH Actions
  |    Test-specific env vars
  |    No Authentik service container in GH Actions — uses docker-compose instead
  |
  +- docker-compose.dev.yml  <- Dev overrides (extends prod)
       Port offsets (v1 vs v2 conflict avoidance)
       Volume mounts for hot reload
```

CI and dev inherit Authentik, the blueprint, healthchecks, and service dependencies from prod. No duplication.

### CI Strategy

CI uses `docker compose` directly instead of GH Actions service containers:

```yaml
# CI step: start backing services (including Authentik)
- name: Start services
  run: docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d

# CI step: wait for app to be ready (depends_on handles Authentik ordering)
- name: Start server
  run: bun run start &
```

**Note on `depends_on`:** Within docker-compose, `depends_on: condition: service_healthy` ensures ordering. But in CI, the app runs outside the compose network (via `bun run start` directly on the runner), so `depends_on` doesn't apply. The CI health poll loop (`for i in $(seq 1 30)`) serves as the wait mechanism. The app connects to Authentik via `localhost:<mapped-port>`, not the Docker network name.

### Dev Strategy

`bun run dev:docker` starts Authentik alongside Postgres, MinIO, and strfry. Developers always work against real Authentik. Authentik is exposed on a dev-specific port offset (e.g., `9100:9000`) in `docker-compose.dev.yml` to avoid conflicts.

## Authentik Infrastructure

### Postgres Init Script

Authentik needs its own database. A Postgres init script creates it:

```sql
-- deploy/docker/postgres-init/01-authentik-db.sql
-- Idempotent: safe to re-run on existing databases
SELECT 'CREATE DATABASE authentik'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'authentik')\gexec
```

Mounted via Postgres `docker-entrypoint-initdb.d`:

```yaml
postgres:
  volumes:
    - ./postgres-init:/docker-entrypoint-initdb.d
```

### Redis/Valkey

Authentik requires Redis (or Valkey) as a message broker for the worker process. Add a Redis container:

```yaml
redis:
  image: redis:7-alpine
  restart: unless-stopped
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5

authentik-server:
  environment:
    AUTHENTIK_REDIS__HOST: redis
  depends_on:
    redis:
      condition: service_healthy

authentik-worker:
  environment:
    AUTHENTIK_REDIS__HOST: redis
  depends_on:
    redis:
      condition: service_healthy
```

**Note:** Verify during implementation whether Authentik 2025.12 still requires Redis. The 2025.10 release notes claimed Redis removal, but the reviewer found evidence it's still needed. If Redis is truly not required, remove this.

### Bootstrap Token

`AUTHENTIK_BOOTSTRAP_TOKEN` is set on the **authentik-server** container (not the app):

```yaml
authentik-server:
  environment:
    AUTHENTIK_BOOTSTRAP_TOKEN: ${AUTHENTIK_BOOTSTRAP_TOKEN}
```

On first startup, Authentik auto-creates an API token with this value. The app uses the same value as `AUTHENTIK_API_TOKEN`:

```yaml
app:
  environment:
    AUTHENTIK_API_TOKEN: ${AUTHENTIK_BOOTSTRAP_TOKEN}
```

Both reference the same env var so they stay in sync.

## Authentik Blueprint

A declarative YAML file at `deploy/docker/authentik-blueprints/llamenos.yaml` auto-provisions Authentik on startup.

### What the Blueprint Creates

1. **OAuth2/OIDC Provider** — configured for the Llamenos application
2. **Application** — registered in Authentik, linked to the provider
3. **Custom Property Mapping** — exposes `user.attributes.nsec_secret` as a claim in the userinfo response
4. **Service Account Group** — with API permissions for user CRUD, session management, and invitation creation

### Blueprint YAML

```yaml
# deploy/docker/authentik-blueprints/llamenos.yaml
# Applied by authentik-worker on startup

version: 1
metadata:
  name: Llamenos Application Setup
  labels:
    blueprints.goauthentik.io/description: "Auto-provision Llamenos IdP integration"

entries:
  # Service account group with API permissions
  - model: authentik_core.group
    id: llamenos-service-group
    attrs:
      name: "Llamenos Service Accounts"
      is_superuser: false
      # Permissions granted via Authentik's RBAC — exact permission
      # names to be verified against 2025.12 API docs during implementation

  # Property mapping: expose nsec_secret user attribute
  - model: authentik_providers_oauth2.scopemapping
    id: llamenos-nsec-secret-mapping
    attrs:
      name: "Llamenos nsec_secret"
      scope_name: llamenos_nsec
      expression: |
        return {"nsec_secret": request.user.attributes.get("nsec_secret", "")}

  # OAuth2 Provider
  - model: authentik_providers_oauth2.oauth2provider
    id: llamenos-provider
    attrs:
      name: "Llamenos Provider"
      authorization_flow:
        !Find [
          authentik_flows.flow,
          [slug, default-provider-authorization-implicit-consent],
        ]
      property_mappings:
        - !Find [
            authentik_providers_oauth2.scopemapping,
            [scope_name, llamenos_nsec],
          ]

  # Application
  - model: authentik_core.application
    attrs:
      name: "Llamenos"
      slug: llamenos
      provider: !KeyOf llamenos-provider
```

The exact blueprint schema will be verified against Authentik 2025.12 docs during implementation.

### Volume Mount

Blueprint must be mounted on **both** `authentik-server` and `authentik-worker` (the worker processes blueprints):

```yaml
authentik-server:
  volumes:
    - ./authentik-blueprints:/blueprints/custom

authentik-worker:
  volumes:
    - ./authentik-blueprints:/blueprints/custom
```

## Bootstrap Flow (First Admin)

The very first user creation:

```
1. Docker Compose starts: Postgres -> Authentik (applies blueprint) -> App
2. Authentik is ready with application + property mappings configured
3. AUTHENTIK_BOOTSTRAP_TOKEN provides the initial API token
4. App starts, IdP adapter initializes with bootstrap token
5. First admin visits /setup -> AdminBootstrap.tsx
6. Admin generates keypair, proves ownership (Schnorr signature)
7. POST /api/auth/bootstrap:
   a. Verify Schnorr proof against ADMIN_PUBKEY env var
   b. Create volunteer record in Postgres
   c. Call idpAdapter.createUser(pubkey) -> creates user in Authentik
   d. idpAdapter.getNsecSecret(pubkey) -> returns real nsecSecret
   e. Return { pubkey, nsecSecret } to client
8. Client encrypts nsec with real KEK (PIN + real nsecSecret + optional PRF)
9. Admin is fully set up with real IdP-bound key
```

No synthetic values. The Authentik user is created atomically with the volunteer record.

## Token Refresh Bug Fix

**Phase 1 bug:** `POST /auth/token/refresh` is behind the `jwtAuth` middleware, which requires a valid access JWT. But the entire purpose of refresh is to get a new access token when the current one has expired. If the access token is expired, the middleware rejects with 401, making refresh impossible.

**Fix:** Remove `jwtAuth` middleware from `/token/refresh`. The endpoint authenticates via the httpOnly refresh cookie alone:

1. Read `llamenos-refresh` cookie
2. Verify the refresh JWT (separate from access JWT verification)
3. Extract pubkey from refresh token's `sub` claim
4. Call `idpAdapter.refreshSession(pubkey)` to confirm user is still active
5. Sign new access JWT
6. Return `{ accessToken }`

No access token required. The refresh cookie IS the credential.

## Enrollment Endpoint

New `POST /auth/enroll` endpoint in the facade. Used by all flows that create new users.

```
POST /auth/enroll
  Body: { pubkey }
  Auth: Valid JWT with `volunteers:create` permission

  1. Verify caller has `volunteers:create` permission
  2. Call idpAdapter.createUser(pubkey)
  3. Return { nsecSecret: <hex> }
```

### Flow-by-Flow Impact

| Flow                      | Before (Phase 1)              | After (Phase 2)                                                                         |
| ------------------------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| Admin bootstrap           | Synthetic `bootstrap` value   | Bootstrap endpoint calls `createUser` -> real nsecSecret                                |
| Volunteer onboarding      | Synthetic `onboarding` value  | After invite accept + WebAuthn register, call `POST /auth/enroll` -> real nsecSecret    |
| Recovery (backup restore) | Synthetic `recovery` value    | Recovery flow calls `POST /auth/enroll` (re-creates Authentik user) -> real nsecSecret  |
| Demo accounts             | Synthetic `demo` value        | Demo setup calls `POST /auth/enroll` -> real nsecSecret                                 |
| Device linking            | Synthetic `device-link` value | **Still synthetic** — new device has no IdP session. Auto-rotates on first real unlock. |

Synthetic values and auto-rotation logic are retained **only for device linking**.

## Permissions Resolution Fix

### Problem

`resolveVolunteerPermissions()` in `auth-facade.ts` returns raw role IDs (e.g., `['admin', 'volunteer']`) instead of resolved permission strings (e.g., `['calls:answer', 'notes:create', 'volunteers:update']`). The JWT `permissions` claim is wrong.

### Fix

The facade bridge middleware in `app.ts` passes `SettingsService` into the facade context. The facade uses it to resolve roles into permissions:

```typescript
const settings = c.get("settings");
const allRoles = await settings.getRoles();
const permissions = resolvePermissions(volunteer.roles, allRoles);
// Sign JWT with resolved permissions
const token = await signAccessToken({ pubkey, permissions }, jwtSecret);
```

This matches how the existing `auth` middleware resolves permissions — the facade just needs access to the same service.

## Server Startup

## Authentik Adapter Fixes

### Session Deletion API

The current `AuthentikAdapter.revokeAllSessions()` uses `DELETE /api/v3/core/authenticated-sessions/?user=<pk>` which may not be a valid bulk deletion endpoint. During implementation, verify the correct approach:

- Option A: List sessions via `GET /api/v3/core/authenticated-sessions/?user=<pk>`, then delete each individually
- Option B: Use a user-specific session revocation endpoint if one exists in 2025.12
- Option C: If bulk DELETE is supported, keep current approach

### Bridge Middleware Null Guard

The bridge middleware in `app.ts` should assert the adapter is non-null at request time as defense-in-depth:

```typescript
if (!_idpAdapter) {
  return c.json({ error: "IdP service not initialized" }, 503);
}
ctx.set("idpAdapter", _idpAdapter);
```

This catches the edge case where the adapter failed to initialize but the server somehow started (e.g., race condition).

## Server Startup

Hard failure replaces graceful fallback:

```typescript
// server.ts — IdP adapter initialization
const { createIdPAdapter } = await import("./idp/index");
const idpAdapter = await createIdPAdapter();
if (!idpAdapter) {
  throw new Error(
    "IdP adapter initialization failed — cannot start without IdP",
  );
}
setIdPAdapter(idpAdapter);
```

Docker Compose's `depends_on: authentik-server: condition: service_healthy` ensures Authentik is ready. If it's not, the app crashes and Docker restarts it.

## Test Coverage

All tests run against real Authentik via docker-compose.

### API Integration Tests

New `tests/api/auth-facade.spec.ts`:

| Test                                                                                       | Flow Exercised                    |
| ------------------------------------------------------------------------------------------ | --------------------------------- |
| Bootstrap creates Authentik user + returns real nsecSecret                                 | First admin setup                 |
| WebAuthn login via virtual authenticator returns JWT                                       | Facade login                      |
| JWT authenticates subsequent API calls                                                     | Token validation                  |
| Token refresh via httpOnly cookie returns new JWT                                          | Refresh flow                      |
| GET /auth/userinfo returns real nsecSecret from Authentik                                  | IdP value retrieval               |
| POST /auth/enroll creates user in Authentik                                                | Volunteer enrollment              |
| Session revocation invalidates refresh                                                     | Revocation                        |
| Admin re-enrollment wipes credentials                                                      | Recovery                          |
| Rate limiting blocks excessive login attempts                                              | Abuse prevention                  |
| Full onboarding: invite -> accept -> enroll -> register passkey -> login                   | End-to-end volunteer flow         |
| IdP temporarily unavailable during token refresh -> clear error, not 500                   | Graceful IdP error handling       |
| Concurrent enrollment of same pubkey -> proper error, not crash                            | Race condition handling           |
| nsecSecret rotation: rotate -> verify userinfo returns current -> confirm -> previous gone | Rotation lifecycle                |
| Bootstrap called twice -> 403 on second call                                               | Idempotency                       |
| JWT from different JWT_SECRET rejected                                                     | Cross-environment token isolation |
| Volunteer deactivation cleans up Authentik user                                            | User lifecycle                    |

### Existing Test Updates

The test setup helper needs to create users in Authentik after creating volunteer records:

```typescript
// tests/helpers/authed-request.ts (or setup project)
// After creating volunteer in Postgres:
await fetch("/auth/enroll", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${adminJwt}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ pubkey }),
});
```

This ensures every test user exists in Authentik and can get a real `nsecSecret`.

### WebAuthn Passkey Tests

`tests/ui/webauthn-passkeys.spec.ts` updated to exercise the full flow:

1. Register passkey via `/auth/webauthn/register-options` + `/register-verify`
2. Login via `/auth/webauthn/login-options` + `/login-verify`
3. Verify JWT returned
4. Use JWT for API calls
5. GET `/auth/userinfo` returns real nsecSecret

### CI Configuration

```yaml
# .github/workflows/ci.yml

# API and E2E test jobs:
steps:
  - name: Start backing services (including Authentik)
    run: >
      docker compose
      -f deploy/docker/docker-compose.yml
      -f deploy/docker/docker-compose.ci.yml
      up -d

  - name: Build frontend
    run: bun run build

  - name: Start server
    env:
      DATABASE_URL: postgresql://llamenos:llamenos@localhost:5432/llamenos
      AUTHENTIK_URL: http://localhost:9100
      AUTHENTIK_API_TOKEN: ${{ env.AUTHENTIK_BOOTSTRAP_TOKEN }}
      # ... other env vars
    run: |
      bun run start > /tmp/server.log 2>&1 &
      # Wait for server ready
      for i in $(seq 1 30); do
        curl -sf http://localhost:3000/api/health/ready && break
        sleep 2
      done

  - name: Run tests
    run: bunx playwright test --project=setup --project=api --project=ui
```

No GH Actions service containers. Docker Compose handles everything.

## Code Changes Summary

### New Files

| File                                               | Purpose                            |
| -------------------------------------------------- | ---------------------------------- |
| `deploy/docker/authentik-blueprints/llamenos.yaml` | Declarative Authentik provisioning |
| `deploy/docker/docker-compose.ci.yml`              | CI-specific compose overrides      |
| `tests/api/auth-facade.spec.ts`                    | Facade integration tests           |

### Modified Files

| File                                             | Change                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/docker/docker-compose.yml`               | Blueprint volume mount, ensure healthcheck                                                                                                                                                                                                                                       |
| `deploy/docker/docker-compose.dev.yml`           | Inherit Authentik from base, add port offsets                                                                                                                                                                                                                                    |
| `.github/workflows/ci.yml`                       | Docker Compose instead of service containers                                                                                                                                                                                                                                     |
| `src/server/server.ts`                           | Hard failure if IdP unavailable                                                                                                                                                                                                                                                  |
| `src/server/app.ts`                              | Pass SettingsService to facade context                                                                                                                                                                                                                                           |
| `src/server/routes/auth.ts`                      | Bootstrap calls `idpAdapter.createUser()`. The bootstrap endpoint currently uses `AppEnv` and has no IdP adapter access — either move bootstrap into the facade, or inject the adapter via the existing bridge middleware (preferred: add `getIdPAdapter()` import from app.ts). |
| `src/server/routes/auth-facade.ts`               | Add `POST /auth/enroll`, fix permissions resolution                                                                                                                                                                                                                              |
| `src/client/routes/onboarding.tsx`               | Call `/auth/enroll` instead of synthetic value                                                                                                                                                                                                                                   |
| `src/client/components/setup/AdminBootstrap.tsx` | Receive real nsecSecret from bootstrap                                                                                                                                                                                                                                           |
| `src/client/routes/login.tsx`                    | Recovery calls `/auth/enroll`                                                                                                                                                                                                                                                    |
| `src/client/components/demo-account-picker.tsx`  | Call `/auth/enroll`                                                                                                                                                                                                                                                              |
| `src/client/lib/key-store-v2.ts`                 | Remove unused synthetic helpers (keep only for device-link)                                                                                                                                                                                                                      |
| `tests/helpers/authed-request.ts`                | Enroll test users in Authentik                                                                                                                                                                                                                                                   |
| `tests/ui/webauthn-passkeys.spec.ts`             | Full facade flow                                                                                                                                                                                                                                                                 |

### Removed

| Item                                                               | Reason                         |
| ------------------------------------------------------------------ | ------------------------------ |
| Synthetic values in 4 of 5 flows                                   | Replaced by real IdP values    |
| Graceful IdP fallback in server.ts                                 | Hard failure — IdP is required |
| GH Actions service containers for Authentik                        | Replaced by docker-compose     |
| `SYNTHETIC_ISSUERS` entries for bootstrap/onboarding/recovery/demo | Only `device-link` retained    |
