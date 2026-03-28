# Phase 2D: Upgrade Server-Key Fields to ECIES E2EE

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade 7 display-only fields from server-key encryption to ECIES envelope E2EE, so even a compromised running server cannot decrypt volunteer names, ban details, caller identifiers, or device labels.

**Architecture:** No schema changes — envelope columns already exist from Phase 1. Services switch from `crypto.serverEncrypt()`/`serverDecrypt()` to `crypto.envelopeEncrypt()`/`envelopeDecrypt()`. API responses return ciphertext + envelopes instead of plaintext. Client components decrypt with `ClientCryptoService.envelopeDecrypt()`.

**Tech Stack:** TypeScript, CryptoService (ECIES envelopes), ClientCryptoService, React components

**Spec:** `docs/superpowers/specs/2026-03-28-phase2d-upgrade-server-key-to-e2ee-design.md`

---

## Fields to Upgrade

| Field | Current | Target | Envelope Recipients |
|---|---|---|---|
| `volunteer.encryptedName` | serverEncrypt | envelopeEncrypt | Self + admin pubkeys |
| `ban.encryptedPhone` | serverEncrypt | envelopeEncrypt | Creating admin + global admins |
| `ban.encryptedReason` | serverEncrypt | envelopeEncrypt | Creating admin + global admins |
| `invite.encryptedName` | serverEncrypt | envelopeEncrypt | Creating admin |
| `call_records.encryptedCallerLast4` | serverEncrypt | envelopeEncrypt | Admin pubkeys |
| `conversations.encryptedContactLast4` | serverEncrypt | envelopeEncrypt | Assigned vol + admin pubkeys |
| `push_subscriptions.encryptedDeviceLabel` | serverEncrypt | envelopeEncrypt | Volunteer's own pubkey |

No schema changes needed — `nameEnvelopes`, `phoneEnvelopes`, `reasonEnvelopes`, `callerLast4Envelopes`, `contactLast4Envelopes`, `deviceLabelEnvelopes`, `labelEnvelopes` columns all exist and default to `[]`.

---

## Task 1: Server Services — Switch to Envelope Encryption

**Files:**
- Modify: `src/server/services/identity.ts` — volunteer name, invite name
- Modify: `src/server/services/records.ts` — ban phone/reason, callerLast4
- Modify: `src/server/services/conversations.ts` — contactLast4
- Modify: `src/server/services/push.ts` — deviceLabel

### For each field, the change is:

**Write (server-originated data like callerLast4, contactLast4):**
```typescript
// Before:
const encrypted = this.crypto.serverEncrypt(value, LABEL_VOLUNTEER_PII)

// After:
const { encrypted, envelopes } = this.crypto.envelopeEncrypt(value, recipientPubkeys, LABEL_VOLUNTEER_PII)
// Store both: encryptedX = encrypted, xEnvelopes = envelopes
```

**Write (client-originated data like volunteer name, ban phone, device label):**
For now, server still encrypts on behalf of the client (the client sends plaintext over TLS, server envelope-encrypts for the right recipients). True client-side encryption will come when clients are updated.

**Read — server can NO LONGER decrypt:**
```typescript
// Before:
const name = this.crypto.serverDecrypt(row.encryptedName, LABEL_VOLUNTEER_PII)

// After — server returns ciphertext + envelopes, client decrypts:
return {
  encryptedName: row.encryptedName,
  nameEnvelopes: row.nameEnvelopes,
  // No plaintext 'name' field — E2EE means server can't see it
}
```

### Specific recipient lists:

- **volunteer.encryptedName**: `[volunteerPubkey, adminPubkey]` (the volunteer themselves + global admin)
- **ban.encryptedPhone/Reason**: `[bannedByPubkey, adminPubkey]` (the banning admin + global admin)
- **invite.encryptedName**: `[createdByPubkey, adminPubkey]` (creating admin + global admin)
- **callerLast4**: `[adminPubkey]` (admins only — volunteers don't see caller IDs in history)
- **contactLast4**: `[assignedToPubkey, adminPubkey].filter(Boolean)` (assigned volunteer + admin)
- **deviceLabel**: `[volunteerPubkey]` (only the volunteer sees their own device labels)
- **webauthn label**: `[volunteerPubkey]` (same)

The admin pubkey comes from `process.env.ADMIN_PUBKEY` (available via the services). Check how existing envelope encryption (e.g., for call records) gets admin pubkeys.

### What services return changes:

Services that previously returned decrypted `name`/`phone` etc. must now return the encrypted form. This means the **service return types change** — routes and clients must handle `encryptedName + nameEnvelopes` instead of `name`.

Check each service's return type and update shared types accordingly.

- [ ] **Step 1: Read current identity service** and find all `serverEncrypt`/`serverDecrypt` calls for volunteer name and invite name
- [ ] **Step 2: Switch volunteer name to envelope encryption** on write, return ciphertext + envelopes on read
- [ ] **Step 3: Switch invite name** similarly
- [ ] **Step 4: Switch ban phone/reason** in records service
- [ ] **Step 5: Switch callerLast4** in records service (server-originated E2EE)
- [ ] **Step 6: Switch contactLast4** in conversations service
- [ ] **Step 7: Switch deviceLabel** in push service
- [ ] **Step 8: Switch webauthn label** in identity service
- [ ] **Step 9: Update shared types** — Hub, Volunteer, Ban, Invite, CallRecord, Conversation, PushSubscription types to include encrypted fields + envelopes instead of plaintext
- [ ] **Step 10: Run tests**

Run: `bun test src/server` and `npx tsc --noEmit`
Expected: Tests may need updating since service return types changed.

- [ ] **Step 11: Commit**

```bash
git add src/server/ src/shared/
git commit -m "feat(crypto): upgrade 7 display-only fields to ECIES E2EE envelopes"
```

---

## Task 2: Client — Envelope Decrypt for E2EE Fields

**Files:**
- Modify: client components that display volunteer names, ban details, caller IDs, device labels

### Pattern:

```typescript
import { useAuth } from '../../lib/auth-context'  // or however keyManager is accessed

// Get the user's crypto service (need secretKey + pubkey for envelope decrypt)
const keyManager = useKeyManager()
const secretKey = keyManager.getSecretKey()
const pubkey = keyManager.getPublicKeyHex()

// Decrypt envelope-encrypted field:
import { ClientCryptoService } from '../../lib/crypto-service'
import { LABEL_VOLUNTEER_PII } from '@shared/crypto-labels'

const crypto = new ClientCryptoService(secretKey, pubkey)
const name = crypto.envelopeDecrypt(
  volunteer.encryptedName as Ciphertext,
  volunteer.nameEnvelopes,
  LABEL_VOLUNTEER_PII
)
```

### Components to update:

1. **Volunteer list/profile** — decrypt `encryptedName` from envelopes
2. **Ban list** — decrypt `encryptedPhone` and `encryptedReason` from envelopes
3. **Invite list** — decrypt `encryptedName` from envelopes
4. **Call history** — decrypt `encryptedCallerLast4` from envelopes
5. **Conversation list** — decrypt `encryptedContactLast4` from envelopes
6. **Push settings** — decrypt `encryptedDeviceLabel` from envelopes
7. **WebAuthn credential list** — decrypt `encryptedLabel` from envelopes

Find each component by searching for where these fields are currently displayed. They may currently show server-decrypted plaintext — switch to client-side envelope decryption.

### Client-side encryption on write:

For forms that create volunteers, bans, invites, or device labels:
- Client encrypts with `ClientCryptoService.envelopeEncrypt()` for the appropriate recipients
- Sends `{ encryptedName, nameEnvelopes }` instead of `{ name }`
- The admin pubkey should be available from the auth context or config

- [ ] **Step 1: Update volunteer name display/creation**
- [ ] **Step 2: Update ban list display/creation**
- [ ] **Step 3: Update invite list display/creation**
- [ ] **Step 4: Update call history display**
- [ ] **Step 5: Update conversation list display**
- [ ] **Step 6: Update push settings display**
- [ ] **Step 7: Update webauthn credential display**
- [ ] **Step 8: Run typecheck and any client tests**
- [ ] **Step 9: Commit**

```bash
git add src/client/
git commit -m "feat(client): envelope decrypt for E2EE volunteer names, bans, caller IDs, device labels"
```

---

## Task 3: API Tests + E2EE Verification

- [ ] **Step 1: Run API tests**

Reset DB, start server, run playwright API tests. Fix failures.

The main issue: API tests that assert `volunteer.name === 'expected'` will fail because the server no longer returns plaintext `name`. Tests need to either:
- Accept encrypted response and skip plaintext assertions
- Or the test helper needs to decrypt with the admin key

For tests that create data and read it back, the simplest fix: accept that the response contains `encryptedName` and `nameEnvelopes` instead of `name`. The test can verify the encrypted field is non-empty.

- [ ] **Step 2: Verify E2EE property**

Add to `src/server/lib/e2ee-verification.test.ts`:

```typescript
test('volunteer name cannot be decrypted with server key after E2EE upgrade', () => {
  // Server creates volunteer with envelope encryption
  // Attempt to serverDecrypt the encryptedName → must fail
  // Only the envelope recipient can decrypt
})
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(crypto): verify Phase 2D E2EE properties, fix API tests"
```
