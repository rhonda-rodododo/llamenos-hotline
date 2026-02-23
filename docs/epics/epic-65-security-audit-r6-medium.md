# Epic 65: Security Audit R6 — Medium Severity Hardening

## Overview

Address Medium severity findings from Security Audit Round 6 (2026-02-23). These issues represent defense-in-depth improvements and should be resolved before production deployment.

## Tasks

### M-1: Fix SSRF Blocklist with Proper CIDR Parsing

**Files**: `src/worker/routes/settings.ts:168-174`, `src/worker/routes/setup.ts:89-93`

1. Create a shared `isPrivateIP(hostname: string): boolean` utility in `src/worker/lib/helpers.ts`
2. Use proper CIDR matching (or at minimum, parse octets and compare numerically)
3. Block: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `169.254.0.0/16`, `127.0.0.0/8`, `0.0.0.0/8`, `::1`, `fe80::/10`, `fc00::/7`, `::ffff:` mapped addresses
4. Apply to both Asterisk ARI URL and Signal API URL validation

### M-2: Add Permission Guards to Call Endpoints

**File**: `src/worker/routes/calls.ts`

1. Add `requirePermission('calls:read-active')` middleware to `GET /calls/active`
2. Add `requirePermission('calls:read-active')` middleware to `GET /calls/today-count`
3. Verify that the `role-volunteer` role includes `calls:read-active` in the default permissions

### M-3: Replace `isAdmin` Query Parameter with Dedicated Route

**File**: `src/worker/durable-objects/identity-do.ts`

1. Add a new route `PATCH /admin/volunteers/:pubkey` that allows all fields
2. Change the existing `PATCH /volunteers/:pubkey` to always enforce the safe-fields allowlist
3. Update `src/worker/routes/volunteers.ts` to call the admin-specific route
4. Remove the `?admin=true` query parameter pattern

### M-4: Add Missing Security Headers to Worker Middleware

**File**: `src/worker/middleware/security-headers.ts`

Add:
```typescript
'X-Permitted-Cross-Domain-Policies': 'none',
'Cross-Origin-Resource-Policy': 'same-origin',
```

Consider `Cross-Origin-Embedder-Policy: require-corp` but test for compatibility with PWA and WebSocket connections first.

### M-5: Strengthen Phone Number Hashing with HMAC

**File**: `src/worker/lib/crypto.ts:56-62`

1. Add an `HMAC_SECRET` environment variable (generated per deployment)
2. Change `hashPhone()` to use `HMAC-SHA256(HMAC_SECRET, "llamenos:phone:" + phone)` instead of bare SHA-256
3. This makes precomputation impossible without the secret
4. Update all callers (ban checks, conversation contact IDs) — the hash format changes, so existing data needs migration
5. Add a migration in the storage migration framework to re-hash existing phone hashes (requires the operator to provide the old format flag during upgrade)

**Note**: This is a breaking change for existing data. Since the project is pre-production, this is acceptable.

### M-6: Use Generic Backup Filename

**File**: `src/client/lib/backup.ts:206`

Change:
```typescript
a.download = `backup-${crypto.getRandomValues(new Uint8Array(4)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')}.json`
```

### M-7: Fix File Metadata ECIES Context String

**File**: `src/client/lib/file-crypto.ts:97`

Change `llamenos:transcription` to `llamenos:file-metadata`. Since no production data exists, this is a clean fix with no migration needed.

### M-8: Add Dependency Vulnerability Scanning to CI

**File**: `.github/workflows/ci.yml`

Add a job that runs `bun audit` (or `npx audit-ci`) and fails on high/critical findings:
```yaml
audit:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@<sha>
    - uses: oven-sh/setup-bun@<sha>
    - run: bun install --frozen-lockfile
    - run: bun audit --level high
```

### M-9: Pin Docker Base Image Tags to Digests

**Files**: `deploy/docker/Dockerfile`, `asterisk-bridge/Dockerfile`

1. Look up current digests for `oven/bun:1` and `node:22-slim`
2. Pin all `FROM` lines to `image@sha256:...`
3. Add a comment with the human-readable tag for reference
4. Document the update procedure in `deploy/docker/README.md`

### M-10: Add PostgreSQL Egress Rule to Helm NetworkPolicy

**File**: `deploy/helm/llamenos/templates/networkpolicy.yaml`

Add a conditional egress rule for external PostgreSQL:
```yaml
{{- if .Values.database.external }}
- to:
    - ipBlock:
        cidr: {{ .Values.database.host }}/32
  ports:
    - protocol: TCP
      port: {{ .Values.database.port | default 5432 }}
{{- end }}
```

## Acceptance Criteria

- [ ] All medium findings addressed
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] E2E tests pass
- [ ] Security headers tested with securityheaders.com (or equivalent)
- [ ] SSRF bypass tested manually with IPv6 and CGNAT addresses
