# Field-Level Encryption Phase 2D: Upgrade Remaining Server-Key Fields to E2EE

**Date:** 2026-03-30 (revised from 2026-03-28 original)
**Status:** Draft
**Scope:** Upgrade display-only fields still using server-key encryption to true E2EE (envelope or hub-key). A compromised running server currently decrypts these — after this phase, it cannot.
**Prerequisite:** Phase 2B complete (hub-key patterns established)
**Threat model:** Nation-state adversaries. Legal compulsion to hand over server secrets. A running server compromise must not reveal volunteer phone numbers, invite details, or subscriber identifiers beyond what the server absolutely needs to function.

---

## Encryption Hierarchy (Strictest → Weakest)

1. **Envelope E2EE** (per-recipient ECIES) — only designated recipients can decrypt. Server never sees plaintext. Use for PII and sensitive per-user data.
2. **Hub-key E2EE** (symmetric, all hub members) — server stores opaque ciphertext. Use for org metadata all hub members need.
3. **Server-key** (server can decrypt) — absolute last resort. Only when the server MUST process the data at runtime (send SMS, call APIs, write audit entries).

The goal: **minimize the server-key surface area.** Every field that the server doesn't need at runtime should be envelope or hub-key encrypted.

---

## Fields to Upgrade

### Already E2EE (confirmed — no work needed)

These fields already have `RecipientEnvelope[]` and are truly E2EE:

| Table | Field | Recipients |
|-------|-------|-----------|
| `volunteers` | `encryptedName` | Self + admin pubkeys |
| `bans` | `encryptedPhone`, `encryptedReason` | Creating admin + admins |
| `invite_codes` | `encryptedName` | Creating admin |
| `call_records` | `encryptedCallerLast4` | Admin pubkeys |
| `conversations` | `encryptedContactLast4` | Assigned user + admins |
| `push_subscriptions` | `encryptedDeviceLabel` | User's own pubkey |
| `webauthn_credentials` | `encryptedLabel` | User's own pubkey |

**Verify:** Confirm these fields' service code actually uses `envelopeEncrypt()`/`envelopeDecrypt()` and NOT `serverEncrypt()`/`serverDecrypt()`. If any service still falls back to server-key despite having envelope columns, fix that.

### Server-key → Envelope E2EE (upgrade needed)

| Table | Field | Current | Target Recipients | Rationale |
|-------|-------|---------|-------------------|-----------|
| `volunteers` | `encryptedPhone` | Server-key (no envelopes) | Self + admin pubkeys | Volunteer phone is PII. Server doesn't need it at runtime — admin views it in the UI. |
| `invite_codes` | `encryptedPhone` | Server-key (no envelopes) | Creating admin | Invite recipient phone is PII. Server doesn't need it after sending the invite. |

### Schema changes needed

Add envelope columns where missing:

```sql
-- Table name depends on whether Volunteer → User rename has been applied
-- Use 'users' if rename is done, 'volunteers' if not
ALTER TABLE users ADD COLUMN phone_envelopes JSONB NOT NULL DEFAULT '[]';
ALTER TABLE invite_codes ADD COLUMN phone_envelopes JSONB NOT NULL DEFAULT '[]';
```

**Dependency:** This spec should be implemented after the Volunteer → User rename spec.

### Fields that MUST stay server-key

These fields require server-side processing at runtime:

| Table | Field | Reason |
|-------|-------|--------|
| `blast_settings` | welcome/bye/double-opt-in messages | Server sends via SMS on subscriber events |
| `audit_log` | event, details | Server writes audit entries (server-originated data) |
| `ivr_audio` | audio_data | Server serves to telephony bridge |
| `push_subscriptions` | endpoint, auth_key, p256dh_key | Server sends push notifications |
| `subscribers` | identifier | Server sends blast messages |
| `provider_config` | credentials, brand_sid, campaign_sid, messaging_service_sid | Server calls telephony/messaging APIs |
| `geocoding_config` | api_key | Server calls geocoding API |
| `signal_registration_pending` | number | Server registers with Signal bridge |

These are irreducible — the server needs to decrypt them to do its job. They remain server-key encrypted. A leaked `SERVER_NOSTR_SECRET` exposes them, but this is inherent to the server's role as telephony/messaging intermediary.

### Fields that could upgrade to hub-key (consider)

| Table | Field | Current | Candidate? | Notes |
|-------|-------|---------|-----------|-------|
| `subscribers` | `encryptedIdentifier` | Server-key | **No** — server needs to send messages |
| `blasts` | `encryptedName` | Server-key | **Yes → Phase 2B** (already covered) |

---

## Service Layer Changes

For each field being upgraded:

```typescript
// Before (server-key):
const encrypted = this.crypto.serverEncrypt(phone, LABEL_USER_PII)
// Store: { encryptedPhone: encrypted }

// After (envelope E2EE):
const { ciphertext, envelopes } = this.crypto.envelopeEncrypt(phone, recipientPubkeys, LABEL_USER_PII)
// Store: { encryptedPhone: ciphertext, phoneEnvelopes: envelopes }
```

For fields where the CLIENT creates the data (volunteer phone on profile update, invite phone):
- Client encrypts with `ClientCryptoService.envelopeEncrypt()` before sending
- API stores ciphertext + envelopes directly

For fields where the SERVER creates the data (none in this phase — all upgraded fields are client-originated):
- N/A

---

## API Changes

Endpoints that return upgraded fields change from plaintext to `{ encryptedX, xEnvelopes }`:

| Endpoint | Before | After |
|----------|--------|-------|
| `GET /api/users/:id` | `{ phone: "+1555..." }` | `{ encryptedPhone: "ab12...", phoneEnvelopes: [...] }` |
| `GET /api/invites` | `{ phone: "+1555..." }` | `{ encryptedPhone: "cd34...", phoneEnvelopes: [...] }` |

Client components add envelope decryption (same pattern as existing E2EE fields — use `decryptObjectFields()` / `useDecrypted()` hooks).

---

## Verification: Audit All `serverEncrypt`/`serverDecrypt` Calls

After this phase, run:

```bash
grep -r "serverEncrypt\|serverDecrypt" src/server/services/ src/server/routes/
```

Every remaining hit should be for fields that MUST stay server-key (blast settings, audit log, IVR audio, push endpoints, subscriber identifiers, provider credentials, geocoding API key). If any hit is for a display-only field, it's a bug — upgrade it.

---

## Testing

### Unit tests
- Verify server cannot decrypt upgraded E2EE fields
- Envelope round-trip for volunteer phone, invite phone
- Recipient list correctness (self + admins for volunteer phone, creator for invite phone)

### API tests
- Endpoints return encrypted fields with envelopes (not plaintext)
- Client-originated data arrives as ciphertext, server stores without decrypting
- Envelope columns populated (not empty `[]`)

### UI E2E tests
- Volunteer phone displayed after key unlock
- Invite phone displayed to creating admin after unlock
- Fields show "[encrypted]" placeholder before unlock

### E2EE verification test
- Extend existing `e2ee-verification.test.ts` to cover newly upgraded fields
- Confirm server service cannot access plaintext for upgraded fields

---

## Scope — Not Covered

- Hub-key upgrade for org metadata (Phase 2B — separate spec)
- Encrypting structural metadata (IDs, timestamps, booleans)
- Re-encryption on role/permission changes (existing envelope rotation patterns handle this)
- Encrypting fields the server must process at runtime (irreducible server-key surface)
