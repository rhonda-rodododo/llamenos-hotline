# Spec: Schema Alignment & API Validation

**Date:** 2026-04-02
**Priority:** High (Pre-Launch)
**Status:** Draft

## Overview

Multiple API endpoints lack Zod validation, several shared schemas are misaligned with their database counterparts, and key routes are missing from the OpenAPI documentation. This work ensures type safety, runtime validation, and complete API documentation.

---

## Issue 1: Auth Facade Endpoints Lack Zod Validation

### Problem

Four public (unauthenticated) endpoints in `src/server/routes/auth-facade.ts` parse request bodies with raw `await c.req.json()` and `as` type casts instead of Zod schemas.

### Affected Endpoints

| Line | Method | Path                             | Current Body Cast                                              |
| ---- | ------ | -------------------------------- | -------------------------------------------------------------- |
| 181  | POST   | `/auth/webauthn/login-verify`    | `{ assertion: unknown; challengeId: string }`                  |
| 233  | POST   | `/auth/invite/accept`            | `{ code: string }`                                             |
| 260  | POST   | `/auth/demo-login`               | `{ pubkey: string }`                                           |
| 312  | POST   | `/auth/webauthn/register-verify` | `{ attestation: unknown; label: string; challengeId: string }` |

### Fix

1. Create Zod schemas in `src/shared/schemas/auth.ts` for each request body
2. Convert each endpoint from plain `app.post()` to `createRoute()` + `.openapi()` pattern
3. This also adds them to the OpenAPI spec at `/api/docs`

### Additional Unvalidated Endpoints

- `src/server/app.ts:189` — `PATCH /messaging/preferences` uses raw JSON
- `src/server/routes/contacts-import.ts:18` — batch import uses raw JSON
- `src/server/routes/messaging/signal-registration.ts` — plain Hono routes

---

## Issue 2: Blast Schema Misalignment

### Problem

The shared API schema (`src/shared/schemas/blasts.ts`) has fundamentally different field names and structures from the database schema (`src/server/db/schema/blasts.ts`).

### Mismatches

| Field   | Shared Schema                                             | DB Schema                                                     | Issue                                      |
| ------- | --------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| Name    | `name: z.string()`                                        | `encryptedName`                                               | DB encrypts; schema exposes plaintext      |
| Content | `content: z.string()`                                     | `encryptedContent`                                            | Same encryption gap                        |
| Status  | `['draft','sending','sent','failed']`                     | `['draft','scheduled','sending','sent','failed','cancelled']` | Missing `scheduled` and `cancelled` states |
| Counts  | `totalCount`, `sentCount`, `failedCount` (individual)     | `stats` (JSONB aggregate)                                     | Structure mismatch                         |
| Channel | `channel: z.enum(['sms','whatsapp','signal'])` (singular) | `targetChannels` (array)                                      | Singular vs array                          |
| Missing | —                                                         | `scheduledAt`, `error`, `contentEnvelopes`                    | DB fields not in schema                    |

### Fix

Rewrite `src/shared/schemas/blasts.ts` to match DB structure. Follow the encrypted field pattern from CLAUDE.md: schema uses `z.string()` for encrypted fields, app code uses branded `Ciphertext` types.

---

## Issue 3: CallLeg Field Name Mismatch

### Problem

- Shared schema (`src/shared/schemas/calls.ts:18`): `volunteerPubkey`
- DB schema (`src/server/db/schema/calls.ts:27`): `userPubkey`
- DB also has `type` field (`'phone' | 'browser'`) missing from shared schema

### Fix

Rename shared schema field to `userPubkey` to match DB. Add `type` field. Update all consumers.

---

## Issue 4: Other Field Mismatches

### Custom Fields

- Shared schema: `type` (line 76-86 of `src/shared/schemas/settings.ts`)
- DB schema: `fieldType` (line 47 of `src/server/db/schema/settings.ts`)

### Blast Settings Keywords

- Shared schema: `subscribeKeyword`, `unsubscribeKeyword` (singular)
- DB schema: `optInKeywords`, `optOutKeywords` (different naming)

### Conversations

- DB has `reportTypeId` (line 40 of `src/server/db/schema/conversations.ts`) not exposed in shared schema

---

## Issue 5: Missing OpenAPI Documentation

19 endpoints bypass `createRoute()`. Most are justified (webhooks, binary responses, dev-only), but these should be documented:

- All auth-facade routes (4 endpoints) — **security-critical, must document**
- `/messaging/preferences` GET and PATCH — public endpoint
- Signal registration endpoints

Telephony webhook routes (9 endpoints) have a legitimate reason to not use JSON schemas (they receive provider-specific form data), but they should still have OpenAPI documentation for completeness.

---

## Testing Strategy

- `bun run typecheck` after each schema change — types flow through the entire app
- Existing API E2E tests should continue passing
- New tests for request body validation rejection (400 on invalid input)
- Verify OpenAPI spec completeness at `/api/openapi.json`
