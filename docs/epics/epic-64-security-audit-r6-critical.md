# Epic 64: Security Audit R6 — Critical & High Fixes

## Overview

Address all Critical and High severity findings from Security Audit Round 6 (2026-02-23). These issues must be resolved before any production deployment.

## Critical Fixes

### C-1: Stop Broadcasting Full Caller Phone Numbers to All Volunteers

**Files**: `src/worker/durable-objects/call-router.ts`, `src/client/routes/index.tsx`

Currently, `call:incoming` and `calls:sync` WebSocket messages include the full `callerNumber` sent to ALL connected volunteers. This must be filtered server-side.

**Implementation**:
1. In `CallRouterDO.broadcastCallUpdate()`, send full `callerNumber` only to the WebSocket tagged with the `answeredBy` pubkey
2. All other volunteers receive `callerLast4` or `'[redacted]'`
3. The `calls:sync` message must also filter per-recipient
4. For the ban-during-call feature, create a new `POST /api/calls/:callSid/ban` endpoint that looks up the caller number server-side from the call record, instead of requiring the client to send it back
5. Update `ActiveCallPanel` to use `callerLast4` for display, removing the full number from the UI entirely for the answering volunteer too (use the server-side ban endpoint)

**Test**: E2E test with two volunteer sessions — verify second volunteer sees `[redacted]` while first volunteer sees last-4 only.

### C-2: Pin `codeql-action` to SHA

**File**: `.github/workflows/docker.yml:66`

Change `github/codeql-action/upload-sarif@v3` to a pinned SHA. Look up the current v3 HEAD SHA and pin to it.

### C-3: Add SHA256 Verification for `git-cliff` Binary

**File**: `.github/workflows/ci.yml:286-288,417-419`

Add checksum verification after download:
```yaml
- name: Install git-cliff
  run: |
    curl -sSfL https://github.com/orhun/git-cliff/releases/download/v2.7.0/... -o git-cliff.tar.gz
    echo "<expected-sha256>  git-cliff.tar.gz" | sha256sum -c -
    tar xz -C /usr/local/bin --strip-components=1 -f git-cliff.tar.gz git-cliff-2.7.0/git-cliff
```

## High Fixes

### H-1: Remove V1 Encryption Codepath

**File**: `src/client/lib/crypto.ts:193-232`

1. Remove `encryptNote` (V1 encrypt function) — no new V1 notes should ever be created
2. Keep `decryptNote` (V1 decrypt) but add a console warning: `console.warn('Decrypting V1 note — this format is deprecated and provides no forward secrecy')`
3. Add an admin-visible banner when V1 notes are detected: "X notes use legacy encryption without forward secrecy. Contact support for migration."
4. Search all callers of `encryptNote` and replace with `encryptNoteV2`

### H-2: Harden Dev Reset Endpoints

**File**: `src/worker/routes/dev.ts`

Add a secondary gate to destructive endpoints:
1. Require a `DEV_RESET_SECRET` environment variable even in development mode
2. The CI workflow already has `E2E_TEST_SECRET` for staging — apply the same pattern to dev
3. If `DEV_RESET_SECRET` is not set, the endpoints should return 404 even in development
4. Update `tests/global-setup.ts` and CI workflow to pass the secret

### H-3: Validate Hub Telephony Provider Config

**File**: `src/worker/durable-objects/settings-do.ts:684-687`

Apply the same validation logic from `updateTelephonyProvider` (lines 433-455) to `setHubTelephonyProvider`. Extract the validation into a shared `validateProviderConfig()` function.

### H-4: Tree-Shake Demo Secrets from Production Bundles

**File**: `src/client/lib/demo-accounts.ts`, `src/client/routes/login.tsx`

1. Change the static import to a dynamic import gated on `demoMode`
2. In `login.tsx`, use `React.lazy()` for `DemoAccountPicker`
3. Verify with `bun run build` that the nsec strings do not appear in the production bundle when demo mode is off

### H-5: Fix Docker Stage 3 Dependency Resolution

**File**: `deploy/docker/Dockerfile`

Replace the npm install stage with bun:
```dockerfile
FROM oven/bun:1.2.3@sha256:<pin> AS deps
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production
```

### H-6: Require `ARI_PASSWORD` in Docker Compose

**File**: `deploy/docker/docker-compose.yml`

Add `ARI_PASSWORD` to the required environment variables:
```yaml
environment:
  ARI_PASSWORD: ${ARI_PASSWORD:?Set ARI_PASSWORD in .env}
```

## Acceptance Criteria

- [ ] All critical findings addressed and verified
- [ ] All high findings addressed and verified
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] E2E tests pass (existing + new tests for C-1)
- [ ] Security audit document updated with fix status
