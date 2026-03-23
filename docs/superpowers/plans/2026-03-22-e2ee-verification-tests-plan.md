# E2EE Verification Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add Playwright E2E tests that verify actual encryption/decryption — not just that the UI says "encrypted end-to-end", but that notes and messages are genuinely encrypted at rest and decryptable by the right parties only.

**Current state:** 0% encryption verification. Tests only check UI presence of "encrypted end-to-end" string. Actual ECIES envelopes, per-note keys, and multi-admin wrapping are completely untested.

---

## Background: How E2EE Works in This App

**Notes (V2):**
1. Client generates random 32-byte note key
2. Note content encrypted with XChaCha20-Poly1305 using note key
3. Note key ECIES-wrapped individually for: author (volunteer) + each admin
4. Server stores `{ encryptedContent, authorEnvelope, adminEnvelopes[] }`
5. Server cannot decrypt — it only holds ciphertext + encrypted keys

**Messages:**
1. Server receives plaintext inbound SMS/WhatsApp/Signal webhook
2. Server generates random message key, encrypts content + wraps key for assigned volunteer + each admin
3. Server stores only ciphertext + envelopes
4. Client decrypts using volunteer or admin private key

**Hub events (Nostr):**
1. Server signs kind 20001 Nostr events
2. Event content encrypted with hub key (random 32 bytes)
3. Hub key ECIES-wrapped per member
4. Relay stores only ciphertext events

---

## Test Infrastructure Needed

### New test helpers in `tests/helpers.ts`

- [x] Add `getRawNote(request, noteId)` — fetches raw note data from API, returns the ciphertext + envelopes without decryption
- [x] Add `decryptNoteAsVolunteer(rawNote, volunteerNsec)` — imports crypto utilities, decrypts the note envelope using volunteer's secret key, returns plaintext
- [x] Add `decryptNoteAsAdmin(rawNote, adminNsec)` — decrypts via admin envelope
- [x] Add `tryDecryptNoteAsOtherVolunteer(rawNote, otherNsec)` — attempts decryption, expects failure
- [x] Import the actual crypto functions from `src/client/lib/crypto.ts` in test context:
  - Playwright's `page.evaluate()` can call `window.__cryptoForTests` if we expose it in test mode
  - OR: use a test-only API endpoint `POST /api/test/decrypt-note` that is only available in `ENVIRONMENT=test` and uses the server's key management
  - **Recommended**: expose crypto functions via `window.__llamenos_test_crypto` in test/dev builds (tree-shaken in production)
- [x] Add `getRawMessage(request, conversationId, messageId)` — fetches raw message ciphertext + envelopes

### Test-mode crypto exposure
- [x] In `src/client/lib/auth.tsx` (or root entry point), when `import.meta.env.MODE === 'test'`:
  ```typescript
  import { decryptNoteV2, decryptMessage } from './crypto'
  window.__llamenos_test_crypto = { decryptNoteV2, decryptMessage }
  ```
- [x] Ensure this is tree-shaken in production builds (guarded by `import.meta.env.MODE === 'test'`)

---

## Phase 1: Note Encryption Tests

- [x] Create `tests/e2ee-notes.spec.ts`

### Test 1.1: Note content is encrypted at rest
```
Given: Volunteer creates a note with body "Test note content"
When: Admin fetches raw note via GET /api/notes/:noteId (raw response, before client decryption)
Then: Response body does NOT contain "Test note content" (plaintext)
Then: Response contains encryptedContent (base64 ciphertext)
Then: Response contains authorEnvelope (ECIES-wrapped key for author)
Then: Response contains adminEnvelopes array (at least one entry for admin)
```
- [x] Implement test using `request.get('/api/notes/:id')` and inspecting JSON directly

### Test 1.2: Volunteer can decrypt their own note
```
Given: Volunteer creates note with body "My note"
When: Volunteer decrypts using their nsec via window.__llamenos_test_crypto.decryptNoteV2()
Then: Decrypted content === "My note"
```
- [x] Implement via `page.evaluate()` calling `window.__llamenos_test_crypto.decryptNoteV2(rawNote, volunteerNsec)`

### Test 1.3: Admin can decrypt any note
```
Given: Volunteer creates note (admin did not create it)
When: Admin attempts to decrypt using admin nsec + adminEnvelope
Then: Decrypted content matches original
```

### Test 1.4: Per-note forward secrecy (unique keys)
```
Given: Volunteer creates note A and note B
When: Fetch raw envelopes for both notes
Then: authorEnvelope(A) !== authorEnvelope(B) (different wrapped keys = different note keys)
```

### Test 1.5: Unauthorized volunteer cannot decrypt
```
Given: Volunteer A creates a note
When: Volunteer B (different keypair) attempts to decrypt Volunteer A's authorEnvelope
Then: Decryption fails (throws / returns null)
```

---

## Phase 2: Message Encryption Tests

- [x] Create `tests/e2ee-messages.spec.ts`

### Test 2.1: Inbound message encrypted at rest
```
Given: Simulate inbound SMS webhook to POST /api/messaging/sms/inbound
With body: { From: "+15555551234", Body: "Hello I need help" }
When: Fetch raw conversation message via API
Then: Response message.content does NOT contain "Hello I need help"
Then: Response contains encryptedContent + envelopes
```
- [x] Implement using `request.post('/api/messaging/sms/inbound', ...)` in test
- [x] May need test env bypass for webhook signature validation

### Test 2.2: Assigned volunteer can decrypt message
```
Given: Message assigned to Volunteer A
When: Volunteer A decrypts via test crypto helper
Then: Plaintext matches original message body
```

### Test 2.3: Unassigned volunteer cannot decrypt
```
Given: Message assigned to Volunteer A
When: Volunteer B attempts decryption
Then: Decryption fails (their key is not in the envelopes)
```

---

## Phase 3: Hub Key Tests

- [x] Create `tests/e2ee-hub-keys.spec.ts`

### Test 3.1: Hub key is random (not derived from identity)
```
Given: Two different hub instances
When: Inspect hub key envelopes
Then: Hub keys are different (random generation, not deterministic)
```

### Test 3.2: Hub key rotation excludes departed member
```
Given: Volunteer A and Volunteer B are hub members
When: Volunteer B is removed from the hub → hub key is rotated
When: New event is published with rotated hub key
When: Volunteer B attempts to decrypt with old hub key
Then: Decryption fails
When: Volunteer A decrypts with new hub key
Then: Success
```

---

## Phase 4: Audit Log Integrity Tests

- [x] Add to `tests/audit-log.spec.ts`:

### Test 4.1: Hash chain is valid
```
Given: Multiple audit log entries exist (from other tests)
When: Fetch all audit entries via GET /api/audit
When: Verify hash chain: entries[i].previousEntryHash === entries[i-1].entryHash
Then: Chain is unbroken
```

### Test 4.2: Tampered entry breaks chain
```
Given: Fetch raw audit entry
When: Modify the entry's details field
When: Recompute expected hash with modified content
Then: Hash does not match stored entryHash (server-side verification)
```
- Note: This test may only be feasible via a test-only introspection endpoint

---

## Completion Checklist

- [x] `window.__llamenos_test_crypto` exposed in test/dev mode only (not production)
- [x] `bun run build` still passes (no test code in production bundle)
- [x] `bun run typecheck` passes
- [x] Note encryption test: plaintext never appears in raw API response
- [x] Note decryption test: volunteer and admin can both decrypt correctly
- [x] Forward secrecy test: two notes have different envelopes
- [x] Message encryption test: inbound message stored as ciphertext
- [x] Unauthorized decryption test: fails for non-recipients
- [x] Hub key rotation test: departed member loses access
- [x] Audit hash chain test: chain valid after multiple operations
- [x] `bunx playwright test tests/e2ee-notes.spec.ts` passes
- [x] `bunx playwright test tests/e2ee-messages.spec.ts` passes
