# Security Audit Report — Round 6 (2026-02-23)

## Scope

Full-project security review covering cryptography, authentication, authorization, API surface, client-side security, CI/CD pipeline, infrastructure configuration, and deployment architecture. This audit builds on the findings of Round 5 (Epic 53) which addressed 18 issues including critical Schnorr verification gaps, CAPTCHA bypass, and XML injection.

**Threat model context**: Llamenos is a crisis response hotline designed to resist well-funded adversaries including nation-state actors, private intelligence firms, and organized far-right groups. The security bar is correspondingly high.

**Deployment context**: Open-source, self-hosted project. Operators range from small organizations deploying Docker Compose on a single VPS to larger deployments on Kubernetes. No centrally-managed production instance exists.

---

## Executive Summary

The cryptographic architecture is strong. The E2EE note encryption (V2 with per-note forward secrecy via ephemeral ECDH + XChaCha20-Poly1305), PIN-encrypted key storage (PBKDF2-SHA256 600K iterations), and Schnorr-based authentication are well-implemented using audited `@noble` library primitives. No custom cryptographic constructions were found.

The primary risk areas are:

1. **PII exposure in the client** — caller phone numbers broadcast to all connected volunteers via WebSocket
2. **Supply chain integrity** — unsigned binary downloads and unpinned actions in CI
3. **Deployment hardening gaps** — self-hosters need prescriptive guidance on VPS hardening, TLS, and secret management
4. **Legacy code paths** — V1 encryption (no forward secrecy) still callable
5. **Demo mode leakage** — hardcoded nsec values compiled into all production bundles

---

## Findings

### CRITICAL

#### ~~C-1: Caller Phone Number Broadcast to All Volunteers via WebSocket~~ — VERIFIED NOT VULNERABLE

**Files**: `src/worker/durable-objects/call-router.ts:300,316-320,336-340`

**Verified**: The `callerNumber` stored in `CallRecord` is already `hashPhone(data.callerNumber)` (SHA-256 hash, not raw number). All WebSocket broadcasts further replace it with `'[redacted]'`. The REST API also redacts for non-admin users. The `callerLast4` (last 4 digits) is transmitted, which is standard practice and acceptable.

**Minor functional issue**: The ban-during-call feature (`index.tsx:177-179`) cannot work because the client never receives the raw phone number. It should be refactored to use a server-side `POST /api/calls/:callSid/ban` endpoint instead.

#### C-2: `github/codeql-action/upload-sarif@v3` Uses Mutable Tag

**File**: `.github/workflows/docker.yml:66`

This action uses a floating `@v3` tag instead of a pinned SHA. Every other action in the repository is correctly SHA-pinned. This step runs in the same job context that has `packages: write` and `security-events: write` permissions. A compromise of the codeql-action repository could inject malicious code into the Docker build pipeline.

**Impact**: Supply chain compromise of Docker image builds.

**Recommendation**: Pin to a full commit SHA, matching the pattern used by all other actions.

#### C-3: `git-cliff` Binary Downloaded Without Checksum Verification

**File**: `.github/workflows/ci.yml:286-288,417-419`

```yaml
curl -sSfL https://github.com/orhun/git-cliff/releases/download/v2.7.0/... | tar xz -C /usr/local/bin
```

A pre-compiled binary is downloaded and executed without SHA256 verification. GitHub release assets are mutable. This step runs in jobs with `contents: write` permission.

**Impact**: Arbitrary code execution in CI with commit/tag/release write access.

**Recommendation**: Add SHA256 checksum verification, or switch to a SHA-pinned GitHub Action wrapper.

---

### HIGH

#### ~~H-1: V1 Legacy Encryption Still Callable (No Forward Secrecy)~~ — FIXED

**File**: `src/client/lib/crypto.ts:193-232`

V1 note encryption derives a static key from the volunteer's identity key via HKDF. All V1 notes share the same derived key — compromising the identity key reveals ALL V1 notes retroactively.

**Fix**: Removed the V1 `encryptNote()` export entirely. V1 `decryptNote()` retained for backward compat. All new notes use `encryptNoteV2()` with per-note ephemeral ECDH.

#### ~~H-2: Dev Reset Endpoints Rely Solely on `ENVIRONMENT` Variable~~ — FIXED

**File**: `src/worker/routes/dev.ts`

Three destructive endpoints (`test-reset`, `test-reset-no-admin`, `test-reset-records`) were protected only by `ENVIRONMENT !== 'development'`.

**Fix**: Added secondary gate via `DEV_RESET_SECRET` / `E2E_TEST_SECRET`. If either env var is set, all reset endpoints require matching `X-Test-Secret` header. Local dev without the secret still works for convenience.

#### H-3: Hub Telephony Provider Config Stored Without Validation

**File**: `src/worker/durable-objects/settings-do.ts:684-687`

`setHubTelephonyProvider` stores arbitrary `unknown` data without type checking, field validation, or provider type allowlist. Compare this to `updateTelephonyProvider` (lines 433-455) which does thorough validation.

**Impact**: Malformed provider config could cause runtime crashes or unexpected behavior when telephony routes attempt to use hub-scoped adapters. An admin with `settings:manage-telephony` permission could inject arbitrary data.

**Recommendation**: Apply the same validation logic used in `updateTelephonyProvider` to the hub variant.

#### ~~H-4: Demo Account nsec Values in All Production Bundles~~ — FIXED

**File**: `src/client/components/demo-account-picker.tsx`

Five demo nsec values were compiled into the login bundle unconditionally.

**Fix**: Changed `DemoAccountPicker` to use dynamic `import()` for `@/lib/demo-accounts`. The nsec values are now code-split into a separate chunk (`demo-accounts-*.js`) only loaded when demo mode is active. Verified: login bundle contains zero nsec private keys.

#### ~~H-5: Docker Stage 3 Resolves Dependencies Without Lockfile~~ — FIXED

**File**: `deploy/docker/Dockerfile` (Stage 3 `deps`)

Stage 3 used `npm install --production` without any lockfile, causing supply chain drift.

**Fix**: Changed Stage 3 to use `oven/bun:1` with `bun install --frozen-lockfile --production --ignore-scripts`, matching Stages 1 and 2.

#### ~~H-6: Asterisk Bridge `ARI_PASSWORD` Has No Required Override~~ — FIXED

**File**: `asterisk-bridge/Dockerfile`, `deploy/docker/docker-compose.yml`, `deploy/docker/.env.example`

The `ARI_PASSWORD` defaulted to `changeme` with no required override in compose.

**Fix**: Added `ARI_PASSWORD` with `:?` required syntax in docker-compose.yml. Removed hardcoded default from Dockerfile. Added to `.env.example`. Updated README to show generation command.

---

### MEDIUM

#### M-1: SSRF Blocklist Incomplete for Connection Test Endpoints

**Files**: `src/worker/routes/settings.ts:168-174`, `src/worker/routes/setup.ts:89-93`

The SSRF check uses string prefix matching (`hostname.startsWith('172.')`) which over-blocks public IPs in 172.0-15.x and 172.32-255.x. More critically, IPv6 link-local (`fe80::`), Cloudflare CGNAT (`100.64.0.0/10`), and IPv4-mapped IPv6 addresses are not blocked.

**Recommendation**: Use proper CIDR subnet parsing. Block `100.64.0.0/10`, `169.254.0.0/16`, `fe80::/10`, `::1`, `fc00::/7`, and IPv4-mapped IPv6 (`::ffff:127.0.0.1`).

#### M-2: `/calls/active` and `/calls/today-count` Have No Permission Guard

**File**: `src/worker/routes/calls.ts:9,22`

Any authenticated user (including reporter-role) can view active call count and call metadata. The `calls:read-active` permission exists in the catalog but is not enforced.

**Recommendation**: Add `requirePermission('calls:read-active')` middleware to both endpoints.

#### M-3: `isAdmin` Query Parameter on Internal DO API

**File**: `src/worker/durable-objects/identity-do.ts:27-31`

The `?admin=true` query parameter on the IdentityDO `PATCH /volunteers/:pubkey` endpoint bypasses the safe-fields allowlist, allowing writes to `roles`, `active`, etc. Currently only called from the `volunteers.ts` route (which checks `volunteers:update` permission), but the pattern is fragile.

**Recommendation**: Replace the URL parameter with a dedicated admin-only route (e.g., `PATCH /admin/volunteers/:pubkey`) that explicitly handles privileged fields.

#### M-4: Incomplete Security Headers in Cloudflare Worker

**File**: `src/worker/middleware/security-headers.ts`

Missing headers that are present in the Caddy config but absent from the Worker:
- `X-Permitted-Cross-Domain-Policies: none`
- `Cross-Origin-Resource-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

**Recommendation**: Add all three headers to the Worker middleware for parity with the Docker/Caddy deployment.

#### M-5: Phone Number Hashing Uses Bare SHA-256

**File**: `src/worker/lib/crypto.ts:56-62`

Phone hashing uses `SHA-256("llamenos:phone:" + phone)`. The domain prefix prevents rainbow table reuse, but SHA-256 provides no computational hardness. With ~10B possible phone numbers globally, an adversary can precompute the entire hash space in hours on commodity hardware.

**Recommendation**: For ban list checks (which need speed), the current approach is acceptable. For stored identifiers in conversations and audit logs, consider HMAC-SHA256 with a server-side secret key (stored as a Cloudflare secret / environment variable). This makes precomputation impossible without the key.

#### M-6: Backup Filename Leaks Pubkey Fragment

**File**: `src/client/lib/backup.ts:206`

```typescript
a.download = `llamenos-backup-${backup.pubkey.slice(0, 8)}.json`
```

A seized device's downloads folder reveals both the app identity ("llamenos") and a pubkey fragment.

**Recommendation**: Use a generic filename like `backup-${randomHex(4)}.json`.

#### M-7: File Metadata ECIES Uses Wrong Context String

**File**: `src/client/lib/file-crypto.ts:97`

`encryptMetadataForPubkey` uses the context string `llamenos:transcription` instead of a unique `llamenos:file-metadata`. While not exploitable in practice (ephemeral keys are always fresh), this is a cryptographic hygiene issue that could enable cross-protocol attacks under unusual conditions.

**Recommendation**: Change to `llamenos:file-metadata`.

#### M-8: No JavaScript Dependency Vulnerability Scanning in CI

Neither CI workflow runs `bun audit` or equivalent. The Trivy scan on Docker images covers OS-level CVEs but not JavaScript dependency CVEs.

**Recommendation**: Add `bun audit` (or `npm audit --omit=dev`) as a CI step.

#### M-9: Floating Base Image Tags in Dockerfiles

**Files**: `deploy/docker/Dockerfile` (`oven/bun:1`, `node:22-slim`), `asterisk-bridge/Dockerfile` (`oven/bun:latest`)

Mutable image tags allow supply chain drift. The asterisk-bridge using `bun:latest` is especially concerning.

**Recommendation**: Pin all base images to specific digests (`image@sha256:...`).

#### M-10: Helm NetworkPolicy Missing PostgreSQL Egress Rule

**File**: `deploy/helm/llamenos/templates/networkpolicy.yaml`

No egress rule for external PostgreSQL (port 5432). In a default-deny Kubernetes CNI, the app cannot connect to managed database services.

**Recommendation**: Add an egress rule for the database service, either by service selector (for in-cluster) or CIDR (for external managed DB).

---

### LOW

#### L-1: Admin Pubkey Exposed in Public `/api/config` Endpoint

**File**: `src/worker/routes/config.ts:64`

The admin's Nostr public key is returned without authentication. While public keys are inherently public, this enables correlation with the admin's identity on other Nostr-connected platforms.

**Recommendation**: Document operational requirement that the admin keypair must be used exclusively for Llamenos. Consider returning `adminPubkey` only to authenticated users.

#### L-2: Volunteer Phone Numbers in Invite List and Delete Dialogs

**Files**: `src/client/routes/volunteers.tsx:184-186,538-540`

Pending invites and delete confirmation dialogs show full phone numbers without masking.

**Recommendation**: Apply the same `maskedPhone()` pattern used elsewhere. Consider re-PIN step-up for unmasking.

#### L-3: `keyPair.secretKey` Propagated Through React State

**File**: `src/client/lib/auth.tsx:396-412`

The deprecated `keyPair` object distributes the raw `Uint8Array` secret key across multiple React component trees. React DevTools or error boundaries could expose it.

**Recommendation**: Refactor to call `keyManager.getSecretKey()` at the point of crypto operations rather than holding it in React state.

#### L-4: Schnorr Tokens Not Bound to Request Path

**File**: `src/worker/lib/auth.ts:35`

The signed message is `llamenos:auth:${pubkey}:${timestamp}` without request method/path. A captured token is reusable across any endpoint within its 5-minute window.

**Recommendation**: Include the request method and path in the signed message for tighter binding.

#### L-5: Rate Limiter Off-by-One

**File**: `src/worker/durable-objects/settings-do.ts:281`

Uses `recent.length > maxPerMinute` (greater-than) rather than `>=`, allowing one extra request per window.

**Recommendation**: Change to `>=`.

#### L-6: Shift Time Format Not Validated

**File**: `src/worker/durable-objects/shift-manager.ts:90`

Shift `startTime`/`endTime` are compared as strings without format validation. Malformed values produce unexpected string comparison results.

**Recommendation**: Validate `HH:MM` format on input.

#### L-7: `style-src 'unsafe-inline'` in CSP

**File**: `src/worker/middleware/security-headers.ts:14`

Required by Tailwind CSS but weakens XSS defense-in-depth.

**Recommendation**: Investigate nonce-based CSP for styles, or accept as a documented trade-off.

#### L-8: Playwright Trace Artifacts May Contain Auth Tokens

**File**: `playwright.config.ts`, `.github/workflows/ci.yml`

Test traces captured on retry may contain session tokens in HAR data. Artifacts are retained for 7 days.

**Recommendation**: Reduce `retention-days` to 1 or scrub HAR data before upload.

---

## Architecture Notes (Known Limitations)

These are documented design trade-offs, not actionable bugs:

| Issue | Status | Rationale |
|-------|--------|-----------|
| Schnorr 5-min replay window | Accepted | HTTPS mitigates; WebAuthn sessions preferred for enrolled users |
| 4-6 digit PIN entropy (~20 bits) | Accepted | PBKDF2 600K iterations makes offline brute-force expensive; usability trade-off |
| WS rate limit resets on DO hibernation | Accepted | Burst window resets after hibernation; acceptable for current load |
| Ban list bypassable via caller-ID spoofing | Accepted | Fundamental PSTN limitation |
| `plaintextForSending` in messaging API | Accepted | SMS/WhatsApp require server-side plaintext; documented in `CHANNEL_SECURITY` |
| Note metadata (callId, authorPubkey) unencrypted | Accepted | Required for server-side filtering; note content is E2EE |

---

## Comparison with Round 5 (Epic 53)

| Category | Round 5 | Round 6 (this audit) |
|----------|---------|---------------------|
| Critical fixes | 3 (Schnorr verify, CAPTCHA bypass, Math.random) | 3 (caller broadcast, CI supply chain x2) |
| High fixes | 7 (invite auth, upload ownership, sessions, etc.) | 6 (V1 legacy, dev endpoints, demo nsec, etc.) |
| Medium fixes | 8 (WebAuthn rate limit, CORS, role guards, etc.) | 10 (SSRF, permissions, headers, dependency audit, etc.) |
| Low / docs | 4 | 8 |

Round 5 focused on authentication bypasses and cryptographic implementation flaws. Round 6 focuses on data exposure, supply chain integrity, deployment security, and defense-in-depth hardening.
