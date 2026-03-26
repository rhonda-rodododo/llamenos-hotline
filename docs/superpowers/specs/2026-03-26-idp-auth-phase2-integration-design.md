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

The app's `depends_on: authentik-server: condition: service_healthy` ensures Authentik is ready before the app starts. No `--wait` flag needed.

### Dev Strategy

`bun run dev:docker` starts Authentik alongside Postgres, MinIO, and strfry. Developers always work against real Authentik.

## Authentik Blueprint

A declarative YAML file at `deploy/docker/authentik-blueprints/llamenos.yaml` auto-provisions Authentik on startup.

### What the Blueprint Creates

1. **OAuth2/OIDC Provider** — configured for the Llamenos application
2. **Application** — registered in Authentik, linked to the provider
3. **Custom Property Mapping** — exposes `user.attributes.nsec_secret` as a claim in the userinfo response
4. **Service Account Group** — with appropriate API permissions for the Llamenos server's `AUTHENTIK_API_TOKEN`

### How It Works

```yaml
# deploy/docker/authentik-blueprints/llamenos.yaml
# Authentik auto-applies blueprints from /blueprints/custom/ on startup

version: 1
metadata:
  name: Llamenos Application Setup
  labels:
    blueprints.goauthentik.io/description: "Auto-provision Llamenos IdP integration"

entries:
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
      authorization_flow: !Find [authentik_flows.flow, [slug, default-provider-authorization-implicit-consent]]
      property_mappings:
        - !Find [authentik_providers_oauth2.scopemapping, [scope_name, llamenos_nsec]]

  # Application
  - model: authentik_core.application
    attrs:
      name: "Llamenos"
      slug: llamenos
      provider: !KeyOf llamenos-provider
```

The exact blueprint schema will be verified against Authentik 2025.12 docs during implementation.

### Volume Mount

```yaml
authentik-server:
  volumes:
    - ./authentik-blueprints:/blueprints/custom
```

### Bootstrap Token

`AUTHENTIK_BOOTSTRAP_TOKEN` env var auto-creates an API token on first Authentik startup. Our server uses this token for all IdP adapter API calls.

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

## Enrollment Endpoint

New `POST /auth/enroll` endpoint in the facade. Used by all flows that create new users.

```
POST /auth/enroll
  Body: { pubkey }
  Auth: Valid JWT (admin creating a volunteer, or bootstrap flow)

  1. Verify caller has enrollment permission
  2. Call idpAdapter.createUser(pubkey)
  3. Return { nsecSecret: <hex> }
```

### Flow-by-Flow Impact

| Flow | Before (Phase 1) | After (Phase 2) |
|------|-------------------|------------------|
| Admin bootstrap | Synthetic `bootstrap` value | Bootstrap endpoint calls `createUser` -> real nsecSecret |
| Volunteer onboarding | Synthetic `onboarding` value | After invite accept + WebAuthn register, call `POST /auth/enroll` -> real nsecSecret |
| Recovery (backup restore) | Synthetic `recovery` value | Recovery flow calls `POST /auth/enroll` (re-creates Authentik user) -> real nsecSecret |
| Demo accounts | Synthetic `demo` value | Demo setup calls `POST /auth/enroll` -> real nsecSecret |
| Device linking | Synthetic `device-link` value | **Still synthetic** — new device has no IdP session. Auto-rotates on first real unlock. |

Synthetic values and auto-rotation logic are retained **only for device linking**.

## Permissions Resolution Fix

### Problem

`resolveVolunteerPermissions()` in `auth-facade.ts` returns raw role IDs (e.g., `['admin', 'volunteer']`) instead of resolved permission strings (e.g., `['calls:answer', 'notes:create', 'volunteers:update']`). The JWT `permissions` claim is wrong.

### Fix

The facade bridge middleware in `app.ts` passes `SettingsService` into the facade context. The facade uses it to resolve roles into permissions:

```typescript
const settings = c.get('settings')
const allRoles = await settings.getRoles()
const permissions = resolvePermissions(volunteer.roles, allRoles)
// Sign JWT with resolved permissions
const token = await signAccessToken({ pubkey, permissions }, jwtSecret)
```

This matches how the existing `auth` middleware resolves permissions — the facade just needs access to the same service.

## Server Startup

Hard failure replaces graceful fallback:

```typescript
// server.ts — IdP adapter initialization
const { createIdPAdapter } = await import('./idp/index')
const idpAdapter = await createIdPAdapter()
if (!idpAdapter) {
  throw new Error('IdP adapter initialization failed — cannot start without IdP')
}
setIdPAdapter(idpAdapter)
```

Docker Compose's `depends_on: authentik-server: condition: service_healthy` ensures Authentik is ready. If it's not, the app crashes and Docker restarts it.

## Test Coverage

All tests run against real Authentik via docker-compose.

### API Integration Tests

New `tests/api/auth-facade.spec.ts`:

| Test | Flow Exercised |
|------|----------------|
| Bootstrap creates Authentik user + returns real nsecSecret | First admin setup |
| WebAuthn login via virtual authenticator returns JWT | Facade login |
| JWT authenticates subsequent API calls | Token validation |
| Token refresh via httpOnly cookie returns new JWT | Refresh flow |
| GET /auth/userinfo returns real nsecSecret from Authentik | IdP value retrieval |
| POST /auth/enroll creates user in Authentik | Volunteer enrollment |
| Session revocation invalidates refresh | Revocation |
| Admin re-enrollment wipes credentials | Recovery |
| Rate limiting blocks excessive login attempts | Abuse prevention |
| Full onboarding: invite -> accept -> enroll -> register passkey -> login | End-to-end volunteer flow |

### Existing Test Updates

The test setup helper needs to create users in Authentik after creating volunteer records:

```typescript
// tests/helpers/authed-request.ts (or setup project)
// After creating volunteer in Postgres:
await fetch('/auth/enroll', {
  method: 'POST',
  headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ pubkey }),
})
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

| File | Purpose |
|------|---------|
| `deploy/docker/authentik-blueprints/llamenos.yaml` | Declarative Authentik provisioning |
| `deploy/docker/docker-compose.ci.yml` | CI-specific compose overrides |
| `tests/api/auth-facade.spec.ts` | Facade integration tests |

### Modified Files

| File | Change |
|------|--------|
| `deploy/docker/docker-compose.yml` | Blueprint volume mount, ensure healthcheck |
| `deploy/docker/docker-compose.dev.yml` | Inherit Authentik from base, add port offsets |
| `.github/workflows/ci.yml` | Docker Compose instead of service containers |
| `src/server/server.ts` | Hard failure if IdP unavailable |
| `src/server/app.ts` | Pass SettingsService to facade context |
| `src/server/routes/auth.ts` | Bootstrap calls `idpAdapter.createUser()` |
| `src/server/routes/auth-facade.ts` | Add `POST /auth/enroll`, fix permissions resolution |
| `src/client/routes/onboarding.tsx` | Call `/auth/enroll` instead of synthetic value |
| `src/client/components/setup/AdminBootstrap.tsx` | Receive real nsecSecret from bootstrap |
| `src/client/routes/login.tsx` | Recovery calls `/auth/enroll` |
| `src/client/components/demo-account-picker.tsx` | Call `/auth/enroll` |
| `src/client/lib/key-store-v2.ts` | Remove unused synthetic helpers (keep only for device-link) |
| `tests/helpers/authed-request.ts` | Enroll test users in Authentik |
| `tests/ui/webauthn-passkeys.spec.ts` | Full facade flow |

### Removed

| Item | Reason |
|------|--------|
| Synthetic values in 4 of 5 flows | Replaced by real IdP values |
| Graceful IdP fallback in server.ts | Hard failure — IdP is required |
| GH Actions service containers for Authentik | Replaced by docker-compose |
| `SYNTHETIC_ISSUERS` entries for bootstrap/onboarding/recovery/demo | Only `device-link` retained |
