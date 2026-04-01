# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Llámenos is a secure crisis response hotline webapp. Callers dial a phone number; calls are routed to on-shift volunteers via parallel ringing. Volunteers log notes in a webapp. Admins manage shifts, volunteers, and ban lists. The app must protect volunteer and caller identity against well-funded adversaries (nation states, right-wing groups, private hacking firms).

**Status: Pre-production.** No legacy fallbacks or data migrations needed. No production SDLC yet.

## Tech Stack

- **Runtime/Package Manager**: Bun (runs TypeScript natively — no bundling step for server)
- **Frontend**: Vite + TanStack Router (SPA, no SSR) + shadcn/ui (component installer)
- **Backend**: Bun + Hono (OpenAPIHono + @hono/zod-openapi) + PostgreSQL + RustFS (self-hosted via Docker/Ansible)
- **Telephony**: Twilio via a `TelephonyAdapter` interface (designed for future provider swaps, e.g. SIP trunks)
- **Auth**: Nostr keypairs (BIP-340 Schnorr signatures) + WebAuthn session tokens for multi-device support
- **i18n**: Built-in from day one — all user-facing strings must be translatable
- **Deployment**: VPS (Ansible/Docker), EU/GDPR-compatible hosting
- **Testing**: Three suites — unit (`bun:test`), API integration (Playwright, no browser), UI E2E (Playwright, Chromium)
- **PWA**: Service worker via vite-plugin-pwa + Workbox; manifest uses generic name "Hotline" for security

## Architecture Roles

| Role | Can See | Can Do |
|------|---------|--------|
| **Caller** | Nothing (GSM phone) | Call the hotline number |
| **Volunteer** | Own notes only | Answer calls, write notes during shift |
| **Admin** | All notes, audit logs, active calls, billing data | Manage volunteers, shifts, ban lists, spam mitigation settings |

## Security Requirements

These are non-negotiable architectural constraints, not guidelines:

- **E2EE / zero-knowledge**: The server should not be able to read call notes, transcripts, or PII. Encrypt at rest minimum; E2EE where feasible.
- **Volunteer identity protection**: Personal info (name, phone) visible only to admins, never to other volunteers or callers.
- **Call spam mitigation**: Real-time ban lists, optional CAPTCHA-like voice bot detection (randomized digit input), network-level rate limiting. Admins toggle these in real-time.
- **Audit logging**: Every call answered, every note created — visible to admins only.
- **GDPR compliance**: EU parent org, data handling must comply.

## Directory Structure

```
src/
  client/           # Frontend SPA (Vite + React)
    routes/         # TanStack file-based routes
    components/     # App components + ui/ (shadcn primitives)
    lib/            # Client utilities (auth, crypto, ws, i18n, hooks)
    locales/        # 13 locale JSON files (en, es, zh, tl, vi, ar, fr, ht, ko, ru, hi, pt, de)
  server/           # Bun/Hono backend
    routes/         # REST API route handlers
    services/       # Business logic services (replacing Durable Objects)
    telephony/      # TelephonyAdapter interface + 5 adapters (Twilio, SignalWire, Vonage, Plivo, Asterisk)
    messaging/      # MessagingAdapter interface + SMS, WhatsApp, Signal adapters
    lib/            # Server utilities (auth, crypto, webauthn)
    db/             # Drizzle ORM schema + migrations
    server.ts       # Entry point
    app.ts          # Hono app wiring
  shared/           # Cross-boundary types and config (@shared alias)
    schemas/        # Zod schemas — single source of truth for API types
      external/     # Third-party webhook/API schemas (Twilio, Vonage, Plivo, Authentik, OpenCage)
      index.ts      # Barrel re-export
    types.ts        # Branded types (Ciphertext fields), constants, re-exports from schemas
    languages.ts    # Centralized language config (codes, labels, Twilio voice IDs)
    crypto-labels.ts # 25 domain separation constants for all cryptographic operations
```

**Path aliases** (tsconfig.json + vite.config.ts):
- `@/*` → `./src/client/*`
- `@server/*` → `./src/server/*`
- `@shared/*` → `./src/shared/*`

## Key Technical Patterns

- **TelephonyAdapter**: Abstract interface for 5 voice providers (Twilio, SignalWire, Vonage, Plivo, Asterisk). All telephony logic goes through this adapter — never call provider APIs directly from business logic.
- **MessagingAdapter**: Abstract interface for text messaging channels (SMS, WhatsApp, Signal). Inbound webhooks route to ConversationService.
- **Parallel ringing**: All on-shift, non-busy volunteers ring simultaneously. First pickup terminates other calls.
- **Shift routing**: Automated, recurring schedule with ring groups. Fallback group if no schedule is defined.
- **Service layer**: Seven PostgreSQL-backed services (IdentityService, SettingsService, RecordsService, ShiftManagerService, CallRouterService, ConversationService, AuditService) replace the former Durable Objects. Drizzle ORM manages schema and migrations.
- **E2EE notes**: Per-note forward secrecy — unique random key per note, wrapped via ECIES for each reader. Dual-encrypted: one copy for volunteer, one for each admin (multi-admin envelopes).
- **E2EE messaging**: Per-message envelope encryption — random symmetric key, ECIES-wrapped for assigned volunteer + each admin. Server encrypts inbound on webhook receipt, discards plaintext immediately.
- **Key management**: PIN-encrypted local key store (`key-manager.ts`). nsec held in closure only, zeroed on lock. Device linking via ephemeral ECDH provisioning rooms.
- **Nostr relay real-time**: Ephemeral kind 20001 events via strfry (self-hosted). All event content encrypted with hub key. Generic tags (`["t", "llamenos:event"]`) — relay cannot distinguish event types.
- **Hub key distribution**: Random 32 bytes (`crypto.getRandomValues`), ECIES-wrapped individually per member via `LABEL_HUB_KEY_WRAP`. Rotation on member departure excludes departed member.
- **Client-side transcription**: WASM Whisper via `@huggingface/transformers` ONNX runtime. AudioWorklet ring buffer → Web Worker isolation. Audio never leaves the browser.
- **SIP WebRTC (JsSIP)**: Browser calling for self-hosted SIP providers (Asterisk, FreeSWITCH, Kamailio). `SipWebRTCAdapter` wraps JsSIP UA for SIP-over-WSS signaling + browser DTLS-SRTP media. Endpoints provisioned via `AsteriskProvisioner` → asterisk-bridge → ARI dynamic config. coturn provides TURN relay for NAT traversal. Caddy terminates TLS and proxies WSS to Asterisk.
- **Reproducible builds**: `Dockerfile.build` with `SOURCE_DATE_EPOCH`, content-hashed filenames. `CHECKSUMS.txt` in GitHub Releases. SLSA provenance. Verification via `scripts/verify-build.sh`.
- **Hash-chained audit log**: SHA-256 chain with `previousEntryHash` + `entryHash` for tamper detection (Epic 77).
- **Blob storage (RustFS)**: S3-compatible object storage via `StorageManager` (`src/server/services/storage-manager.ts`). Per-hub buckets (`hub-{hubId}`) with lifecycle policies. Provider-agnostic `STORAGE_*` env vars (`STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`). Used for voicemail recordings, attachments, and encrypted exports.
- **Domain separation**: All 25 crypto context constants in `src/shared/crypto-labels.ts` — NEVER use raw string literals for crypto contexts.
- **Zod schemas as single source of truth**: `src/shared/schemas/` defines zod schemas for all API types. Types are derived via `z.infer<>`. Route files use `OpenAPIHono` + `createRoute()` from `@hono/zod-openapi` for declarative validation. `types.ts` re-exports from schemas where possible — types using branded `Ciphertext` remain in `types.ts` (schemas use plain `string` for API validation, app code uses branded types for safety). OpenAPI spec auto-generated at `/api/openapi.json`, Scalar docs at `/api/docs`.
- **External schemas**: `src/shared/schemas/external/` contains zod schemas for third-party webhook payloads (Twilio, Vonage, Plivo, Asterisk) and API responses (Authentik, OpenCage). These are the runtime validation contract for incoming external data.

### Encrypted Field Development Guide

The codebase has three encryption tiers for stored data:

1. **Envelope-encrypted PII** (user names, phones): ECIES-wrapped per-user. Decrypted in `decryptObjectFields()` / `decryptArrayFields()` via crypto worker.
2. **Hub-key encrypted org metadata** (role names, shift names, report type names, custom field labels, team names): Symmetric XChaCha20 with the hub's shared key. Decrypted client-side via `decryptHubField()`.
3. **Per-note forward secrecy** (call notes): Unique random key per note, ECIES-wrapped per reader.

**Adding a new encrypted field (hub-key tier):**

1. **DB schema**: Use `ciphertext('encrypted_foo')` column type from `src/server/db/crypto-columns.ts`. No plaintext column — the `name`/`label` fields in API responses are empty strings; clients decrypt.
2. **Server create**: Always fall back to plaintext: `const encryptedFoo = (data.encryptedFoo ?? data.foo) as Ciphertext`. This handles the case where the client's hub key cache is empty.
3. **Server update**: Same fallback pattern — if `data.encryptedFoo` is undefined, check `data.foo`: `} else if (data.foo !== undefined) { encFields.encryptedFoo = data.foo as Ciphertext }`.
4. **Client queryFn**: Decrypt in the React Query `queryFn`, not in components: `foo: decryptHubField(item.encryptedFoo, hubId, item.foo)`. The `hubId` must come from `useConfig().currentHubId`, not hardcoded.
5. **Client mutation**: Send both plaintext and encrypted: `{ foo: value, encryptedFoo: encryptHubField(value, hubId) }`. The encrypted value is `undefined` when hub key isn't loaded — the server fallback handles this.
6. **Query cache invalidation**: If calling API functions directly (not through React Query mutations), add `void queryClient.invalidateQueries({ queryKey: queryKeys.domain.subkey() })` after the API call succeeds.

**ENCRYPTED_QUERY_KEYS exhaustiveness check** (`src/client/lib/query-client.ts`):

Every query key domain in `queryKeys` must be classified as either `ENCRYPTED_QUERY_KEYS` or `PLAINTEXT_QUERY_KEYS`. Adding a new domain to `queryKeys` without classifying it produces a compile-time error via the `MissingDomains` type check. Encrypted domains are cleared on lock and invalidated on unlock.

## Gotchas

- `@noble/ciphers` and `@noble/hashes` require `.js` extension in imports (e.g., `@noble/ciphers/chacha.js`)
- `schnorr` is a separate named export: `import { schnorr } from '@noble/curves/secp256k1.js'`
- Nostr pubkeys are x-only (32 bytes) — prepend `"02"` for ECDH compressed format
- `secp256k1.getSharedSecret()` returns 33 bytes; extract x-coord with `.slice(1, 33)`
- Workbox `navigateFallbackDenylist` excludes `/api/` and `/telephony/` routes from SPA caching
- Nostr relay (strfry) is a core service, not optional — always runs with Docker Compose and Helm
- `SERVER_NOSTR_SECRET` must be exactly 64 hex chars; server derives its Nostr keypair via HKDF
- Hub key is random bytes, NOT derived from any identity key — see `hub-key-manager.ts`
- JsSIP `reloadModule('res_pjsip.so')` disrupts ALL active SIP sessions — avoid during live calls; memory sorcery wizard makes dynamic config effective immediately
- Asterisk WSS requires TLS — in production Caddy proxies WSS→WS; for local dev use `scripts/dev-certs.sh` (mkcert)
- coturn TURN credentials use time-limited HMAC from shared secret — not static username/password
- JsSIP `newRTCSession` fires for both incoming and outgoing — check `originator === 'remote'`
- RustFS container runs as UID 10001 — volume ownership must match

## Development Commands

```bash
bun install                              # Install dependencies
bun run dev                              # Vite dev server (frontend only)
bun run dev:server                       # Bun watch server (localhost:3000)
bun run dev:docker                       # Start backing services (postgres, rustfs, strfry) for local dev
bun run dev:docker:down                  # Stop dev backing services
bun run migrate                          # Apply pending Drizzle migrations
bun run migrate:generate                 # Generate SQL migration files from schema changes
bun run build                            # Vite build → dist/client/
bun run lint                             # Biome lint check
bun run lint:fix                         # Biome lint auto-fix
bun run start                            # Start Bun server (production)
bun run deploy                           # Deploy marketing site
bun run deploy:site                      # Deploy marketing site only (cd site && ...)
bun run test:unit                        # Run colocated unit tests (bun:test)
bun run test:api                         # Run API integration tests (no browser)
bun run test:e2e                         # Run UI E2E tests (Chromium)
bun run test:all                         # Run all tests (unit + playwright)
bun run test:interactive                 # Playwright interactive UI mode
bunx playwright test                     # Run all Playwright suites
bunx playwright test tests/ui/smoke.spec.ts  # Run a single test file
bun run typecheck                        # Type check (tsc --noEmit)
bun run bootstrap-admin                  # Generate admin keypair
./scripts/test-local.sh                  # Run E2E tests against Docker backend
PLAYWRIGHT_WORKERS=3 bunx playwright test    # Run with 3 workers (after isolation verified)
```

**Local Dev Port Offsets** (v1 uses offsets to avoid conflicts with llamenos v2 at ~/projects/llamenos):
- v2 (llamenos): postgres:5432, rustfs:9000/9001, strfry:7777
- v1 (llamenos-hotline): postgres:5433, rustfs:9002/9003, strfry:7778

**Deployment rules — NEVER run `wrangler pages deploy` directly** (site deploy only). Always use `bun run deploy:site` which runs from the `site/` directory via Astro. Running it from the root would deploy the wrong build.

**Primary demo deployment is VPS-based via Ansible.** Use `cd deploy/ansible && just deploy-demo` to deploy the demo instance. See `deploy/ansible/justfile` for all Ansible commands and `deploy/ansible/demo_vars.example.yml` for demo configuration.

**Key config files**: `playwright.config.ts`, `.env` (DATABASE_URL, HMAC_SECRET, Twilio creds + ADMIN_PUBKEY, gitignored)

**Local E2E tests**: Copy `.env.local.example` to `.env.local`, fill in your values, then start backing services with `bun run dev:docker` before running `bun run dev:server`.

## Significant Work Requires Planning

**Any non-trivial effort MUST go through the superpowers workflow.** This applies to ALL domains — API endpoints, UI features, deployment changes, protocol updates, documentation overhauls, tooling, test infrastructure, schema migrations, encrypted field additions. If it touches more than 2-3 files or introduces new concepts, it's significant.

### Workflow (mandatory for significant work)

1. **Brainstorm**: Invoke `superpowers:brainstorming` to explore requirements, edge cases, and approach options.
2. **Plan**: Invoke `superpowers:writing-plans` to create a concrete implementation plan with file paths and steps.
3. **Implement**: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` for multi-step work. Use domain-specific skills alongside:
   - API routes → `api-schema-dev` skill
   - UI components → `frontend-design` skill
   - Tests → `test-writer` + `test-runner` skills
   - Complex features → `feature-dev:feature-dev` skill
4. **Review**: Invoke `superpowers:requesting-code-review` before merging. For received feedback, use `superpowers:receiving-code-review`.
5. **Test**: Use `test-writer` skill for writing tests and `test-runner` skill for running them. Run tests iteratively during implementation, not just at the end.
6. **Verify**: Invoke `superpowers:verification-before-completion` before claiming work is done.

### API Schema Pattern

All API routes use `OpenAPIHono` + `createRoute()` from `@hono/zod-openapi` for declarative validation. The pattern:

1. **Define zod schemas** in `src/shared/schemas/` (e.g., `src/shared/schemas/report-types.ts`).
2. **Export TypeScript types** from schemas: `export type CreateReportTypeInput = z.infer<typeof CreateReportTypeSchema>`.
3. **Define routes with `createRoute()`**: Includes request body/param schemas, response schemas, tags, middleware.
4. **Implement with `.openapi(route, handler)`**: Use `c.req.valid('json')` for validated bodies, `c.req.valid('param')` for path params.
5. **Import types in client code** from `@shared/schemas` (not `@shared/types`) for schema-available types.
6. **External webhook schemas** in `src/shared/schemas/external/` for third-party payloads (Twilio, Vonage, etc.).

OpenAPI spec auto-generated at `/api/openapi.json`. Scalar docs at `/api/docs`.

**Note:** Types using branded `Ciphertext` (RecipientEnvelope, KeyEnvelope, CustomFieldDefinition) remain in `src/shared/types.ts` — schemas use `z.string()` for API validation but app code needs the branded type for compile-time safety.

### Testing New Features

Use the `test-writer` skill for guidance on writing tests. Use the `test-runner` skill for running them.

- **Unit tests** (`.test.ts` colocated): Pure functions, services with mocked deps. Fast, no services needed.
- **API E2E** (`tests/api/`): Endpoint behavior through HTTP. Use `authed-request.ts` helper. No browser.
- **UI E2E** (`tests/ui/`): Full browser interaction. Use `data-testid` selectors. Use auth fixtures from `tests/fixtures/auth.ts`.
- **Run tests iteratively**: Don't wait until the end. Run affected suites after each logical chunk of implementation.
- **Hub-encrypted data in tests**: After creating hub-encrypted data (shifts, roles, report types, custom fields), remember that the React Query cache must be invalidated for other pages to see the new data.

## Claude Code Working Style

- **Always run `bun run typecheck` and `bun run build` before committing and pushing.** Never push code that doesn't build. If typecheck or build fails, fix it before committing.
- Implement features completely — no stubs, no shortcuts, no TODOs left behind.
- **Every feature or fix must include tests.** Use the right suite for the job:
  - Testing a pure function or class? → colocated `.test.ts` with `bun:test`
  - Testing an API endpoint's behavior? → `tests/api/` (Playwright, no browser)
  - Testing what a user sees and clicks? → `tests/ui/` (Playwright, Chromium)
  - Use `tests/helpers/authed-request.ts` for authenticated API tests without a browser.
  - Some unit tests require Postgres — start backing services with `bun run dev:docker` first.
  A feature is not complete until its tests are written and passing.
- Edit files in place; never create copies. Git history is the backup. Commit regularly when work is complete, don't worry about accidentally committing unrelated changes.
- Keep the file tree lean. Use git commits frequently to checkpoint progress.
- No legacy fallbacks or migration code until this file notes the app is in production.
- Use `docs/epics/` for planning feature epics. Track backlog in `docs/NEXT_BACKLOG.md` and completed work in `docs/COMPLETED_BACKLOG.md` with every iteration
- Use context7 plugin to look up current docs for Twilio, Hono, TanStack, shadcn/ui, Drizzle, and other libraries before implementing.
- Use the feature-dev plugin for guided development of complex features.
- Use Playwright plugin for E2E test development and debugging.
- Clean up unused files/configs when pivoting. Keep code modular and DRY — refactor proactively.
- Update related documentation when requirements, architecture, or design changes occur.
- NEVER delete or regress functionality to fix type issues or get tests passing. Only remove features if explicitly asked or when replacing as part of new work.
- Use parallel agent execution where it makes sense to keep things moving.
