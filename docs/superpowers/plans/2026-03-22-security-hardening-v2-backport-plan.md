# Security Hardening — v2 Audit Backport Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply security fixes from v2's 2026-03-21 security audit that are relevant to v1's web/server architecture. Desktop, iOS, and Android findings are out of scope for v1.

**Source:** `~/projects/llamenos/docs/security/SECURITY_AUDIT_2026-03-21.md` and related v2 specs.

---

## Phase 1: Worker Backend — Critical & High

### 1.1 CRIT-H1: Hub key endpoint missing membership check (CRITICAL)

**Issue:** `GET /api/hubs/:hubId/key` allows any authenticated user to probe hub IDs without membership check.

- [ ] **VERIFY FIRST:** Read `src/worker/routes/hubs.ts` — find the `GET /:hubId/key` handler. If membership check already present (`isMember` via `volunteer.hubRoles` + `isSuperAdmin` via `checkPermission(permissions, '*')`), mark as ✓ already done and skip remaining steps.
- [ ] If NOT already present: add membership check — authenticated user must be a member of `hubId` OR be super-admin
- [ ] Return `403` for authenticated non-members, `401` for unauthenticated
- [ ] Add test: non-member volunteer gets 403, member gets 200 with encrypted envelope

### 1.2 HIGH-W1: `serverEventKeyHex` returned to all authenticated users (HIGH)

**Issue:** Global Nostr relay decryption key returned to every authenticated user via `/api/auth/me`, not scoped to membership.

- [ ] Read `src/worker/routes/auth.ts` — find where `serverEventKeyHex` is returned
- [ ] Verify: is this a global key or per-hub ECIES-wrapped key?
  - If global: scope return to users with `settings:manage` or remove entirely (use per-hub ECIES)
  - If already per-hub ECIES-wrapped: verify the wrapping is correct and skip this item
- [ ] Ensure hub key is delivered as ECIES envelope (client unwraps locally), not as plaintext hex

### 1.3 HIGH-W3: Raw caller phone written to audit log (HIGH)

**Issue:** `POST /api/bans` (or equivalent) logs raw phone number to audit log instead of HMAC hash.

- [ ] Search for audit log writes in `src/worker/routes/bans.ts` and `src/worker/lib/`
- [ ] Any place a caller phone appears in audit log context: replace with `hashPhone(phone, hmacSecret)`
- [ ] Verify `DATA_CLASSIFICATION.md` rule: caller phone must be hashed, never plaintext

### 1.4 HIGH-W4: Dev endpoint returns 403 instead of 404 (HIGH)

**Issue:** `/api/dev/reset` or similar dev endpoints return 403 (revealing existence) when `DEV_RESET_SECRET` not configured.

- [ ] Find dev/test endpoints in `src/worker/routes/` (search for `DEV_RESET_SECRET`, `test-reset`)
- [ ] **Narrow scope:** The production-env path already returns 404. Focus on the `ENVIRONMENT=demo` + no `DEV_RESET_SECRET` case which returns 403.
- [ ] Change: when `DEV_RESET_SECRET` is not set (regardless of `ENVIRONMENT`), return `404 Not Found` (not `403`)
- [ ] Ensure dev endpoints are completely absent in production builds (env check at startup)

### 1.5 HIGH-W5: Missing `encodeURIComponent` on `accountSid` in Twilio URL construction (HIGH)

**Issue:** Twilio settings test constructs URLs with unsanitized `accountSid`, enabling path traversal.

- [ ] Find Twilio provider URL construction in `src/worker/routes/settings.ts` or telephony adapters
- [ ] Add Zod regex validation for SID format: `/^AC[a-f0-9]{32}$/` before URL construction
- [ ] Apply `encodeURIComponent()` as defense-in-depth even with validation

### 1.6 MED-W1: Hub-scoped routes allow cross-hub access via global endpoint (MEDIUM)

**Issue:** Some routes mounted on both global and hub-scoped routers; global endpoint may allow access across all hubs.

- [ ] Audit route mounting in `src/worker/app.ts` (or entry point): which routes are on `/api/*` vs `/api/hubs/:hubId/*`?
- [ ] For any resource route (notes, calls, reports, conversations) on the global router: require `hubId` from request context, query, or body for non-super-admin requests; return 400 if absent
- [ ] Do NOT break super-admin global access — super-admins can legitimately use global routes without a hubId
- [ ] Non-super-admin requests must always have a `hubId` in scope

### 1.7 MED-W2: Direct ban by phone bypasses identity protection model (MEDIUM)

**Issue:** `POST /api/bans` accepts raw phone number — inconsistent with the model that volunteers never handle phone numbers directly.

- [ ] Remove `bans:create` permission from the default Volunteer role configuration (in the role definitions / seeded role data)
- [ ] The existing `requirePermission('bans:create')` check in the route handler already enforces this correctly — no handler changes needed
- [ ] Volunteers must use `POST /api/calls/:callId/ban` which resolves the phone hash server-side from the call record
- [ ] Add test: volunteer calling `POST /api/bans` directly gets 403; admin can still call it

---

## Phase 2: Code Quality Issues (from v2 `2026-03-21-code-quality.md`)

These production-risk defects were identified in v2 but the same patterns likely exist in v1.

### 2.1 Empty catch blocks in critical paths

**Issue:** Silent failures in auth, permissions, messaging, service factories — errors swallowed, not logged.

- [ ] Search v1 codebase for empty catch blocks: `grep -r "catch.*{}" src/`
- [ ] For each: either (a) log the error with structured context, or (b) rethrow if the caller should handle it
- [ ] Critical paths that must never silently fail:
  - Auth token verification
  - Permission guard middleware
  - Outbound message send
  - WebAuthn credential verification
  - Hub key loading / ECIES unwrap

### 2.2 Offline outbox queue plaintext race condition

**Issue:** When sending messages offline, the queue may persist plaintext content before encryption completes (async race).

- [ ] Find the outbox/offline queue in `src/client/lib/` (search for "queue", "outbox", "pending")
- [ ] Verify: is message content encrypted BEFORE being queued/persisted, or after?
- [ ] If after: fix the order — encrypt synchronously, then enqueue the ciphertext (never queue plaintext)
- [ ] Add test: verify queued messages contain ciphertext, not plaintext

### 2.3 Type assertion bypasses (`as any`, `db as any`)

**Issue:** TypeScript `as any` casts in service layer bypass type safety, enabling runtime type errors.

- [ ] Search for `as any` in `src/worker/` and `src/client/lib/`
- [ ] For each: replace with proper typing or runtime validation (Zod)
- [ ] Per CLAUDE.md: avoid `any` — use `unknown` with narrowing or proper generics

### 2.4 Hardcoded CORS origin

**Issue:** CORS `allowedOrigins` may have hardcoded `localhost` instead of using `CORS_ALLOWED_ORIGINS` env var.

- [ ] Find CORS configuration in `src/worker/` (search for `cors`, `allowedOrigins`, `Access-Control`)
- [ ] If hardcoded: replace with `process.env.CORS_ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:5173']`
- [ ] Add to env documentation and `demo_vars.example.yml`

---

## Phase 3: CI/CD Supply Chain

### 3.1 ~~Docker base images~~ — ALREADY FIXED (Round 6, M-9)

All images pinned to SHA256 digests in Dockerfile, docker-compose, and Helm. No action needed.

### 3.2 ~~`bun install` without `--frozen-lockfile`~~ — ALREADY FIXED (Round 6, H-5)

Switched to `--frozen-lockfile` in Docker build. Verify CI `bun install` steps also use it — if yes, skip.

### 3.3 Workflow permissions over-scoped

**Issue:** Release workflows grant `contents:write` at the workflow level; should be per-job.

- [ ] Read `.github/workflows/ci.yml` — find `permissions:` blocks
- [ ] Move `contents:write` from workflow-level to only the `release` job that needs it
- [ ] Other jobs: explicitly set `contents:read` (least privilege)

---

## Phase 4: Environment Variable Startup Validation

**Issue:** Some critical env vars are only validated when first used, not at startup. Improves diagnostics.

- [ ] In `src/platform/node/env.ts` (or `src/worker/env.ts`), add startup validation for:
  - `APP_URL` — required (used for invite links, CORS, webhooks)
  - `CORS_ALLOWED_ORIGINS` — warn if not set (falls back to localhost-only)
  - Telephony credentials: warn (not error) if `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` missing (telephony disabled)
  - `NOSTR_RELAY_URL` — warn if not set (relay features degraded)
- [ ] Log a startup summary: "✓ Database connected | ⚠ NOSTR_RELAY_URL not set" etc.

---

## Completion Checklist

- [ ] Hub key endpoint requires membership check (CRIT-H1)
- [ ] `serverEventKeyHex` scoped correctly or replaced with per-hub ECIES (HIGH-W1)
- [ ] Audit log never writes raw phone numbers (HIGH-W3)
- [ ] Dev endpoints return 404 when secret not configured (HIGH-W4)
- [ ] Twilio SID validated with regex before URL construction (HIGH-W5)
- [ ] Cross-hub access prevented on global routes (MED-W1)
- [ ] Direct ban-by-phone restricted to admins (MED-W2)
- [ ] No empty catch blocks in critical paths
- [ ] Offline queue encrypts before persisting (no plaintext queued)
- [ ] `as any` eliminated from service layer
- [ ] CORS uses env var, not hardcoded localhost
- [ ] Docker base images pinned to SHA256
- [ ] CI uses `--frozen-lockfile`
- [ ] Workflow permissions least-privilege per job
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
