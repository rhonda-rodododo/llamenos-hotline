# Security Hardening (v2 Audit Backport) — Design Spec

**Date:** 2026-03-22
**Status:** Draft

## Background

A security audit of the v2 llamenos codebase (`docs/security/SECURITY_AUDIT_2026-03-21.md`) found 58 issues across the full platform (desktop, iOS, Android, web). This spec covers only the issues relevant to v1's web + server architecture. Desktop/mobile findings are out of scope for v1.

## Issues In Scope

Seven worker/server findings + four code quality issues + three CI supply chain issues.

---

## Worker Backend Issues

### CRIT-H1: Hub Key Endpoint Missing Membership Check

`GET /api/hubs/:hubId/key` allows any authenticated user to probe the endpoint without verifying they are a member of that hub. An attacker with any valid session token can enumerate hub IDs.

**VERIFY FIRST:** Read `src/worker/routes/hubs.ts` at the `GET /:hubId/key` handler. If a membership check is already present (`isMember` via `volunteer.hubRoles` + `isSuperAdmin` via `checkPermission(permissions, '*')`), mark this item as ✓ already done.

**Fix (if not already present):** Add membership check before returning the hub key envelope:
- `isMemberOf(user.pubkey, hubId)` OR `isSuperAdmin(user)` → allow
- Otherwise → 403

### HIGH-W1: Relay Event Key Scoped Incorrectly

If `serverEventKeyHex` (the Nostr relay decryption key) is returned to all authenticated users via `/api/auth/me` rather than being scoped to hub membership, any compromised volunteer session exposes the relay key for all hubs.

**Fix:** Verify the current implementation. If it returns a global key: replace with per-hub ECIES-wrapped hub key delivered via the hub key endpoint (the correct architecture). If it already returns per-hub ECIES envelopes: document that CRIT-H1 is the only remaining issue and close HIGH-W1.

### HIGH-W3: Raw Caller Phone in Audit Log

`POST /api/bans` or any ban-creation path may write raw phone numbers to the audit log. Per data classification, caller phones must be HMAC-hashed before storage.

**Fix:** Any phone number that enters the ban flow must be replaced with `hashPhone(phone, hmacSecret)` before the audit log write. The raw number is used only for the HMAC computation, then discarded.

### HIGH-W4: Dev Endpoints Return 403 Not 404

Dev/test reset endpoints (`/api/dev/reset`, etc.) return HTTP 403 when the `DEV_RESET_SECRET` env var is not set. A 403 reveals the endpoint exists. A 404 would not.

**Narrow scope:** The production-env path already returns 404 correctly. The remaining edge case is: when `ENVIRONMENT=demo` and `DEV_RESET_SECRET` is not set, the endpoint returns 403 instead of 404. The fix is specifically in this demo-env code path.

**Fix:** When `DEV_RESET_SECRET` is not configured (regardless of `ENVIRONMENT` value), return 404 — not 403.

### HIGH-W5: Unvalidated `accountSid` in Twilio URL

Telephony settings test constructs a Twilio URL with the `accountSid` value without validation. A path-traversal input could produce an unexpected URL.

**Fix:** Validate `accountSid` matches `/^AC[a-f0-9]{32}$/` with Zod before URL construction. Apply `encodeURIComponent` as defence in depth.

### MED-W1: Cross-Hub Access via Global Routes

Routes mounted on both `/api/*` (global) and `/api/hubs/:hubId/*` (hub-scoped) may not enforce hub scoping on the global path. A non-admin with a valid session could potentially access resources from a different hub.

**Fix:** Audit route mounting. Enforce that any resource route (notes, calls, reports, conversations) on the global router requires a `hubId` in context or returns 400 if absent and the caller is not a super-admin. Super-admin global access (e.g. cross-hub audit views) must continue to work — do NOT break that. The fix is: for non-super-admin requests on global routes, `hubId` must be present in request context, query, or body; return 400 if absent.

### MED-W2: Direct Ban by Phone Not Restricted to Admins

`POST /api/bans` with a raw `phoneNumber` body is accessible to volunteers. Per the identity protection model, volunteers should never directly handle phone numbers.

**Fix:** Remove `bans:create` permission from the default Volunteer role configuration. With that permission absent from the Volunteer role, the existing `requirePermission('bans:create')` check in the route handler will correctly block volunteers — no changes to the route handler itself are needed. Volunteers without `bans:create` must use `POST /api/calls/:callId/ban` instead, which resolves the phone hash server-side from the call record. The fix is in the role permission configuration, not the route handler.

---

## Code Quality Issues

### Empty Catch Blocks in Critical Paths

Silent failures where errors are swallowed rather than logged. Critical paths: auth token verification, permission guards, outbound message send, WebAuthn credential verification, hub key loading.

**Fix:** Audit all `catch` blocks. For each: log with structured context, or rethrow. Never `catch (e) {}`.

### Offline Queue Plaintext Race Condition

The offline message queue may persist message content before client-side encryption completes, leaving a window where plaintext is in persistent storage.

**Fix:** Encryption must complete synchronously before enqueuing. The queue must only ever contain ciphertext.

### TypeScript `as any` in Service Layer

Type assertion bypasses allow runtime type errors that TypeScript should catch.

**Fix:** Replace `as any` with proper types or `unknown` + narrowing. Follow existing CLAUDE.md guidance against `any`.

### Hardcoded CORS Origin

CORS allowed origins may be hardcoded rather than driven by `CORS_ALLOWED_ORIGINS` env var.

**Fix:** Read from env var; fall back to localhost only in development.

---

## CI Supply Chain Issues

### ~~Docker Image Tags Not Pinned to Digest~~ — ALREADY FIXED

Round 6 audit M-9: All Docker base images pinned to SHA256 digests in Dockerfile, docker-compose, and Helm. **No action needed.**

### ~~`bun install` Without `--frozen-lockfile`~~ — ALREADY FIXED

Round 6 audit H-5: Switched to `bun` with `--frozen-lockfile` in Docker Stage 3. **Verify CI workflows also use `--frozen-lockfile`** — if they do, no action needed.

### Workflow Permissions Over-Scoped

`contents:write` granted at workflow level rather than per-job.

**Fix:** Move to per-job permission grants; most jobs only need `contents:read`.

---

## Implementation Approach

These fixes are all independent and can be parallelised:
- Worker backend fixes: one PR touching `src/worker/routes/` and `src/worker/lib/`
- Code quality fixes: one PR per file area
- CI fixes: one PR touching `.github/` and `deploy/docker/`

No new database schema required. No new dependencies required (all fixes are defensive code changes or configuration).

---

## Verification

- Hub key endpoint: non-member → 403; member → 200
- Audit log ban entry: inspect DB row, verify no raw phone
- Dev endpoints with no secret set: 404 not 403
- Twilio SID: Zod validation rejects malformed SID
- Grep for empty catch blocks: zero results in `src/`
- Grep for `as any`: zero results in `src/worker/`
- Docker image digests: all `FROM` statements use `@sha256:` format
