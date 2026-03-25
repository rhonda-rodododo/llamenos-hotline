# Voicemail Phase 1: Fix the Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the voicemail persistence bug, add encrypted audio storage in MinIO, implement `deleteRecording()` on all adapters, and fix the test suite.

**Architecture:** The `/voicemail-recording` webhook handler persists `hasVoicemail` + `recordingSid` to `call_records`, then a background job downloads the audio from the provider, encrypts it via the existing `FilesService` pattern (ECIES envelopes + XChaCha20-Poly1305), stores the encrypted blob in MinIO, and deletes the provider's copy. A `voicemailFileId` column on `call_records` links to the encrypted file.

**Tech Stack:** Bun, Hono, Drizzle ORM, PostgreSQL, MinIO (S3-compatible), `@noble/ciphers` (XChaCha20-Poly1305), `@noble/curves/secp256k1` (ECIES), faster-whisper (already wired via `createTranscriptionService()`).

**Spec:** `docs/superpowers/specs/2026-03-25-voicemail-completion-design.md` (Phase 1)

**Key discovery:** The faster-whisper wiring is already complete — `src/server/lib/transcription.ts` implements `createTranscriptionService()` and is called in `loadEnv()`. No work needed for Task 1.3 from the spec.

---

## File Structure

### Modified
| File | Responsibility |
|---|---|
| `src/shared/crypto-labels.ts` | Add `LABEL_VOICEMAIL_WRAP` and `LABEL_VOICEMAIL_TRANSCRIPT` |
| `src/server/db/schema/records.ts` | Add `voicemailFileId` column to `call_records` |
| `src/server/db/schema/settings.ts` | Add `voicemailMaxBytes`, `callRecordingMaxBytes` to `call_settings` |
| `src/server/telephony/adapter.ts` | Add `deleteRecording()` to `TelephonyAdapter` interface |
| `src/server/telephony/twilio.ts` | Implement `deleteRecording()` |
| `src/server/telephony/signalwire.ts` | Implement or verify inherited `deleteRecording()` |
| `src/server/telephony/plivo.ts` | Implement `deleteRecording()` |
| `src/server/telephony/vonage.ts` | Implement `deleteRecording()` via Media API |
| `src/server/telephony/asterisk.ts` | Implement `deleteRecording()` via bridge |
| `src/server/telephony/test.ts` | Implement `deleteRecording()` no-op stub |
| `src/server/routes/telephony.ts` | Fix persistence bug in `/voicemail-recording` handler |
| `src/server/lib/crypto.ts` | Export server-side binary encryption function for voicemail audio |
| `src/server/lib/transcription-manager.ts` | Use `LABEL_VOICEMAIL_TRANSCRIPT` for domain separation |
| `tests/api/voicemail-webhook.spec.ts` | Fix conditional guards, add storage/persistence tests |

### New
| File | Responsibility |
|---|---|
| `src/server/lib/voicemail-storage.ts` | Orchestrates: download audio → encrypt → store in MinIO → delete from provider → update call record |

### Migrations
| File | Description |
|---|---|
| `src/server/db/migrations/NNNN_voicemail_storage.sql` | Add `voicemail_file_id` to `call_records`, add `voicemail_max_bytes` and `call_recording_max_bytes` to `call_settings` |

---

## Task 1: Add Crypto Labels

**Files:**
- Modify: `src/shared/crypto-labels.ts`

- [ ] **Step 1: Add voicemail crypto labels**

Add two new domain separation constants after the existing labels:

```ts
/** Voicemail audio symmetric key wrapping (ECIES) */
export const LABEL_VOICEMAIL_WRAP = 'llamenos:voicemail-audio'

/** Voicemail transcript encryption */
export const LABEL_VOICEMAIL_TRANSCRIPT = 'llamenos:voicemail-transcript'
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/shared/crypto-labels.ts
git commit -m "feat: add LABEL_VOICEMAIL_WRAP and LABEL_VOICEMAIL_TRANSCRIPT crypto labels"
```

---

## Task 2: Schema Migration — voicemailFileId + configurable limits

**Files:**
- Modify: `src/server/db/schema/records.ts`
- Modify: `src/server/db/schema/settings.ts`
- Create: migration via `bun run migrate:generate`

- [ ] **Step 1: Add voicemailFileId to callRecords**

In `src/server/db/schema/records.ts`, add after `recordingSid`:

```ts
voicemailFileId: text('voicemail_file_id'),
```

- [ ] **Step 2: Add configurable limits to callSettings**

In `src/server/db/schema/settings.ts`, add to the `callSettings` table:

```ts
voicemailMaxBytes: integer('voicemail_max_bytes').notNull().default(2097152), // 2MB
callRecordingMaxBytes: integer('call_recording_max_bytes').notNull().default(20971520), // 20MB
```

- [ ] **Step 3: Generate migration**

Run: `bun run migrate:generate`

This creates a new SQL migration file in `src/server/db/migrations/`.

- [ ] **Step 4: Apply migration**

Run: `bun run migrate`

Verify by checking DB state — the columns should exist.

- [ ] **Step 5: Add voicemailFileId to CreateCallRecordData**

In `src/server/types.ts`, the `CreateCallRecordData` interface (line ~550) is manually defined. Add `voicemailFileId?: string` after `recordingSid`:

```ts
voicemailFileId?: string
```

Also in `src/server/services/records.ts`, add `voicemailFileId` to the `set()` call inside `updateCallRecord` (follow the pattern of the other optional fields like `recordingSid`):

```ts
...(data.voicemailFileId !== undefined && { voicemailFileId: data.voicemailFileId }),
```

- [ ] **Step 5b: Add 'voicemail' to FileRecord.contextType union**

In `src/shared/types.ts`, update the `contextType` field on `FileRecord` (line ~239):

```ts
contextType?: 'conversation' | 'note' | 'report' | 'custom_field' | 'voicemail'
```

- [ ] **Step 5c: Make FileRecord.conversationId optional**

In `src/shared/types.ts`, `FileRecord.conversationId` (line 227) is required `string`, but voicemail files have no conversation. Change to:

```ts
conversationId: string | null
```

Check all callers of `createFileRecord` to ensure they still compile. The existing callers should already pass a string value, so this change is backwards-compatible.

- [ ] **Step 6: Run typecheck and build**

Run: `bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/db/schema/records.ts src/server/db/schema/settings.ts src/server/db/migrations/ src/server/types.ts
git commit -m "feat: add voicemail_file_id column and configurable storage limits"
```

---

## Task 3: Add deleteRecording() to Adapter Interface + All Implementations

**Files:**
- Modify: `src/server/telephony/adapter.ts`
- Modify: `src/server/telephony/twilio.ts`
- Modify: `src/server/telephony/signalwire.ts`
- Modify: `src/server/telephony/plivo.ts`
- Modify: `src/server/telephony/vonage.ts`
- Modify: `src/server/telephony/asterisk.ts`
- Modify: `src/server/telephony/test.ts`
- Test: `src/server/telephony/test-adapter.test.ts`

- [ ] **Step 1: Write failing test for deleteRecording on TestAdapter**

In `src/server/telephony/test-adapter.test.ts`, add:

```ts
test('deleteRecording tracks deletion', async () => {
  await adapter.deleteRecording('REC123')
  expect(adapter.deletedRecordings).toContain('REC123')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/telephony/test-adapter.test.ts`
Expected: FAIL — `deleteRecording` not defined

- [ ] **Step 3: Add deleteRecording to TelephonyAdapter interface**

In `src/server/telephony/adapter.ts`, add after `getRecordingAudio`:

```ts
/**
 * Delete a recording from the provider after encrypted storage.
 * No-op if the provider doesn't support deletion (e.g., URL-based expiry).
 */
deleteRecording(recordingSid: string): Promise<void>
```

- [ ] **Step 4: Implement deleteRecording on TestAdapter**

In `src/server/telephony/test.ts`, add a tracking array and the method:

```ts
// In class TestAdapter, add property:
deletedRecordings: string[] = []

// Add method:
async deleteRecording(recordingSid: string): Promise<void> {
  this.deletedRecordings.push(recordingSid)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/server/telephony/test-adapter.test.ts`
Expected: PASS

- [ ] **Step 6: Implement deleteRecording on TwilioAdapter**

In `src/server/telephony/twilio.ts`, add method using the existing `twilioApi` helper:

```ts
async deleteRecording(recordingSid: string): Promise<void> {
  await this.twilioApi(`/Recordings/${recordingSid}.json`, { method: 'DELETE' })
}
```

API: `DELETE https://api.twilio.com/2010-04-01/Accounts/{sid}/Recordings/{sid}.json` → 204

- [ ] **Step 7: Implement deleteRecording on SignalWireAdapter**

Check if `SignalWireAdapter extends TwilioAdapter`. If it inherits `twilioApi` and overrides `getApiBaseUrl()`, the Twilio implementation is inherited. If not, add the same method. SignalWire is Twilio API-compatible.

- [ ] **Step 8: Implement deleteRecording on PlivoAdapter**

In `src/server/telephony/plivo.ts`, add using the existing `plivoApi` helper:

```ts
async deleteRecording(recordingSid: string): Promise<void> {
  await this.plivoApi(`/Recording/${recordingSid}/`, { method: 'DELETE' })
}
```

API: `DELETE https://api.plivo.com/v1/Account/{authId}/Recording/{recordingId}/` → 204

- [ ] **Step 9: Implement deleteRecording on VonageAdapter**

In `src/server/telephony/vonage.ts`. Vonage stores recording URLs, not SIDs. The `recordingSid` from `parseRecordingWebhook` is actually the full `recording_url`. The media ID must be extracted or we use the Media API. Check the existing `vonageApi` helper and implement:

```ts
async deleteRecording(recordingSid: string): Promise<void> {
  // Vonage recordingSid is the recording_url; extract media ID from URL path
  // URL format: https://api.nexmo.com/v1/files/{uuid}
  // Media API delete: DELETE https://api.nexmo.com/v3/media/{uuid}
  try {
    const url = new URL(recordingSid)
    const mediaId = url.pathname.split('/').pop()
    if (!mediaId) return
    await fetch(`https://api.nexmo.com/v3/media/${mediaId}`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${btoa(`${this.apiKey}:${this.apiSecret}`)}` },
    })
  } catch (err) {
    console.error('[vonage] Failed to delete recording:', err)
  }
}
```

Verify the Vonage recording URL format by checking `parseRecordingWebhook` in vonage.ts — it sets `recordingSid: data.recording_url`. The URL path contains the file UUID.

- [ ] **Step 10: Implement deleteRecording on AsteriskAdapter**

In `src/server/telephony/asterisk.ts`, using the existing `this.bridge.request`:

```ts
async deleteRecording(recordingSid: string): Promise<void> {
  await this.bridge.request('DELETE', `/recordings/${recordingSid}`)
}
```

Note: The bridge endpoint `DELETE /recordings/:name` is part of Phase 3 (Asterisk bridge). For now, implement the adapter method — it will work once the bridge endpoint is added. Consider a try/catch for graceful failure if bridge doesn't support it yet.

- [ ] **Step 11: Run typecheck**

Run: `bun run typecheck`
Expected: PASS — all adapters implement the interface

- [ ] **Step 12: Commit**

```bash
git add src/server/telephony/
git commit -m "feat: add deleteRecording() to TelephonyAdapter interface and all implementations"
```

---

## Task 4: Server-Side Binary Encryption for Voicemail Audio

**Files:**
- Modify: `src/server/lib/crypto.ts`
- Test: `src/server/lib/crypto.test.ts` (or create if it doesn't exist)

The existing `encryptMessageForStorage()` handles string plaintext. Voicemail audio is binary (`Uint8Array`). We need a server-side function that encrypts binary data with the ECIES envelope pattern, using `LABEL_VOICEMAIL_WRAP` for domain separation.

- [ ] **Step 1: Write failing test for binary encryption**

```ts
import { describe, expect, test } from 'bun:test'
import { encryptBinaryForStorage, decryptBinaryFromStorage } from './crypto'
import { LABEL_VOICEMAIL_WRAP } from '@shared/crypto-labels'

describe('encryptBinaryForStorage', () => {
  test('encrypts and decrypts binary data for a recipient', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1')
    const privkey = schnorr.utils.randomPrivateKey()
    const pubkey = Buffer.from(schnorr.getPublicKey(privkey)).toString('hex')

    const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const result = encryptBinaryForStorage(plaintext, [pubkey], LABEL_VOICEMAIL_WRAP)

    expect(result.encryptedContent).toBeDefined()
    expect(result.readerEnvelopes).toHaveLength(1)
    expect(result.readerEnvelopes[0].pubkey).toBe(pubkey)

    // Decrypt
    const decrypted = decryptBinaryFromStorage(
      result.encryptedContent,
      result.readerEnvelopes[0],
      privkey,
      LABEL_VOICEMAIL_WRAP
    )
    expect(decrypted).toEqual(plaintext)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/lib/crypto.test.ts`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement encryptBinaryForStorage**

In `src/server/lib/crypto.ts`, add a new exported function. Follow the same pattern as `encryptMessageForStorage` but accept `Uint8Array` input. Use `VoicemailKeyEnvelope` as the return type since `eciesWrapKeyServer` returns `{ wrappedKey, ephemeralPubkey }` (different field name from `FileKeyEnvelope.encryptedFileKey`):

```ts
/** Envelope for voicemail audio encryption key — matches eciesWrapKeyServer output. */
export interface VoicemailKeyEnvelope {
  pubkey: string
  wrappedKey: string
  ephemeralPubkey: string
}

export function encryptBinaryForStorage(
  plaintext: Uint8Array,
  readerPubkeys: string[],
  label: string
): { encryptedContent: string; readerEnvelopes: VoicemailKeyEnvelope[] } {
  // Generate random 32-byte symmetric key
  const fileKey = new Uint8Array(32)
  crypto.getRandomValues(fileKey)
  const nonce = new Uint8Array(24)
  crypto.getRandomValues(nonce)
  const cipher = xchacha20poly1305(fileKey, nonce)
  const ciphertext = cipher.encrypt(plaintext)
  // Store as: nonce(24) || ciphertext
  const combined = new Uint8Array(24 + ciphertext.length)
  combined.set(nonce, 0)
  combined.set(ciphertext, 24)
  const encryptedContent = bytesToHex(combined)

  // Wrap key for each reader (eciesWrapKeyServer is file-private, called within same file)
  const readerEnvelopes: VoicemailKeyEnvelope[] = readerPubkeys.map((pubkey) => ({
    pubkey,
    ...eciesWrapKeyServer(fileKey, pubkey, label),
  }))

  return { encryptedContent, readerEnvelopes }
}
```

Also export a matching `decryptBinaryFromStorage` for testing and future playback. `eciesUnwrapKeyServer` does not exist yet — implement it in the same file following the inverse of `eciesWrapKeyServer`:

```ts
function eciesUnwrapKeyServer(
  envelope: { wrappedKey: string; ephemeralPubkey: string },
  privateKey: Uint8Array,
  label: string
): Uint8Array {
  const ephemeralPub = hexToBytes(envelope.ephemeralPubkey)
  const shared = secp256k1.getSharedSecret(privateKey, ephemeralPub)
  const sharedX = shared.slice(1, 33)

  const labelBytes = utf8ToBytes(label)
  const keyInput = new Uint8Array(labelBytes.length + sharedX.length)
  keyInput.set(labelBytes)
  keyInput.set(sharedX, labelBytes.length)
  const symmetricKey = sha256(keyInput)

  const packed = hexToBytes(envelope.wrappedKey)
  const nonce = packed.subarray(0, 24)
  const ciphertext = packed.subarray(24)
  const cipher = xchacha20poly1305(symmetricKey, nonce)
  return cipher.decrypt(ciphertext)
}

export function decryptBinaryFromStorage(
  encryptedContentHex: string,
  envelope: VoicemailKeyEnvelope,
  privateKey: Uint8Array,
  label: string
): Uint8Array {
  const fileKey = eciesUnwrapKeyServer(envelope, privateKey, label)
  const combined = hexToBytes(encryptedContentHex)
  const nonce = combined.subarray(0, 24)
  const ciphertext = combined.subarray(24)
  const cipher = xchacha20poly1305(fileKey, nonce)
  return cipher.decrypt(ciphertext)
}
```

Note: `eciesWrapKeyServer` is a file-private function in crypto.ts — `encryptBinaryForStorage` is added to the same file so it can call it directly. No need to export it.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/server/lib/crypto.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/lib/crypto.ts src/server/lib/crypto.test.ts
git commit -m "feat: add encryptBinaryForStorage for voicemail audio encryption"
```

---

## Task 5: Voicemail Storage Orchestrator

**Files:**
- Create: `src/server/lib/voicemail-storage.ts`
- Test: `src/server/lib/voicemail-storage.test.ts`

This module orchestrates: download audio from provider → validate size → encrypt → store in MinIO via FilesService → delete from provider → update call record.

- [ ] **Step 1: Write test for the orchestrator**

```ts
import { describe, expect, test, mock } from 'bun:test'
import { storeVoicemailAudio } from './voicemail-storage'

describe('storeVoicemailAudio', () => {
  test('downloads, encrypts, stores, and deletes recording', async () => {
    const fakeAudio = new Uint8Array([0, 1, 2, 3])
    const mockAdapter = {
      getRecordingAudio: mock(async () => fakeAudio.buffer as ArrayBuffer),
      deleteRecording: mock(async () => {}),
    }
    const mockFiles = {
      createFileRecord: mock(async () => ({ id: 'file-123' })),
      putAssembled: mock(async () => {}),
      completeUpload: mock(async () => {}),
    }
    const mockRecords = {
      updateCallRecord: mock(async () => ({})),
    }

    await storeVoicemailAudio({
      callSid: 'CA123',
      recordingSid: 'REC456',
      hubId: 'hub-1',
      adminPubkeys: ['aabbcc'],
      adapter: mockAdapter as any,
      files: mockFiles as any,
      records: mockRecords as any,
      maxBytes: 2097152,
    })

    expect(mockAdapter.getRecordingAudio).toHaveBeenCalledWith('REC456')
    expect(mockFiles.putAssembled).toHaveBeenCalled()
    expect(mockFiles.createFileRecord).toHaveBeenCalled()
    expect(mockFiles.completeUpload).toHaveBeenCalled()
    expect(mockAdapter.deleteRecording).toHaveBeenCalledWith('REC456')
    expect(mockRecords.updateCallRecord).toHaveBeenCalledWith('CA123', 'hub-1', expect.objectContaining({ voicemailFileId: expect.any(String) }))
  })

  test('returns oversized and keeps provider copy when audio exceeds maxBytes', async () => {
    const bigAudio = new Uint8Array(3_000_000) // 3MB > 2MB default
    const mockAdapter = {
      getRecordingAudio: mock(async () => bigAudio.buffer as ArrayBuffer),
      deleteRecording: mock(async () => {}),
    }
    const mockFiles = {
      createFileRecord: mock(), putAssembled: mock(), completeUpload: mock(),
    }

    const result = await storeVoicemailAudio({
      callSid: 'CA123',
      recordingSid: 'REC456',
      hubId: 'hub-1',
      adminPubkeys: ['aabbcc'],
      adapter: mockAdapter as any,
      files: mockFiles as any,
      records: { updateCallRecord: mock() } as any,
      maxBytes: 2097152,
    })

    expect(result).toBe('oversized')
    // Provider copy kept as fallback — NOT deleted
    expect(mockAdapter.deleteRecording).not.toHaveBeenCalled()
    // No storage attempted
    expect(mockFiles.putAssembled).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/lib/voicemail-storage.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement voicemail-storage.ts**

```ts
import { randomUUID } from 'node:crypto'
import type { TelephonyAdapter } from '../telephony/adapter'
import type { FilesService } from '../services/files'
import type { RecordsService } from '../services/records'
import { encryptBinaryForStorage } from './crypto'
import { LABEL_VOICEMAIL_WRAP } from '@shared/crypto-labels'
import type { FileKeyEnvelope } from '@shared/types'

interface StoreVoicemailParams {
  callSid: string
  recordingSid: string
  hubId: string
  adminPubkeys: string[]
  adapter: TelephonyAdapter
  files: FilesService
  records: RecordsService
  maxBytes: number
}

export async function storeVoicemailAudio(params: StoreVoicemailParams): Promise<string | 'oversized'> {
  const { callSid, recordingSid, hubId, adminPubkeys, adapter, files, records, maxBytes } = params

  // 1. Download audio from provider
  const audioBuffer = await adapter.getRecordingAudio(recordingSid)
  if (!audioBuffer) {
    throw new Error(`Failed to download recording ${recordingSid} for call ${callSid}`)
  }

  const audioBytes = new Uint8Array(audioBuffer)

  // 2. Validate size — if over limit, log warning and keep provider copy as fallback
  if (audioBytes.length > maxBytes) {
    console.warn(
      `[voicemail] Audio (${audioBytes.length} bytes) exceeds max (${maxBytes} bytes) for call ${callSid} — keeping provider copy`
    )
    return 'oversized'
  }

  // 3. Encrypt audio with ECIES envelopes for each admin
  const { encryptedContent, readerEnvelopes } = encryptBinaryForStorage(
    audioBytes,
    adminPubkeys,
    LABEL_VOICEMAIL_WRAP
  )

  // 4. Store encrypted blob in MinIO via FilesService
  const fileId = randomUUID()
  const encryptedBytes = Buffer.from(encryptedContent, 'hex')

  await files.putAssembled(fileId, new Uint8Array(encryptedBytes))
  await files.createFileRecord({
    id: fileId,
    conversationId: null,
    messageId: null,
    uploadedBy: 'system:voicemail',
    recipientEnvelopes: readerEnvelopes as any,
    encryptedMetadata: [],
    totalSize: encryptedBytes.length,
    totalChunks: 1,
    status: 'complete',
    contextType: 'voicemail',
    contextId: callSid,
  })
  await files.completeUpload(fileId)

  // 5. Delete from provider — only after successful storage
  await adapter.deleteRecording(recordingSid)

  // 6. Update call record with file reference
  await records.updateCallRecord(callSid, hubId, { voicemailFileId: fileId })

  return fileId
}
```

Adjust the `FilesService` method signatures as needed — check `createFileRecord`'s exact parameter types. The `contextType: 'voicemail'` and `contextId: callSid` fields link the file to the call. If `createFileRecord` doesn't accept `contextType`/`contextId`, check the actual interface and adapt.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/server/lib/voicemail-storage.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/lib/voicemail-storage.ts src/server/lib/voicemail-storage.test.ts
git commit -m "feat: add voicemail audio storage orchestrator (download, encrypt, store, delete)"
```

---

## Task 6: Fix the Persistence Bug in /voicemail-recording Handler

**Files:**
- Modify: `src/server/routes/telephony.ts` (the `/voicemail-recording` handler, ~line 504-532)

- [ ] **Step 1: Add top-level import for storeVoicemailAudio**

At the top of `src/server/routes/telephony.ts`, add:

```ts
import { storeVoicemailAudio } from '../lib/voicemail-storage'
```

- [ ] **Step 2: Write a test for the persistence fix**

In `tests/api/voicemail-webhook.spec.ts`, add a focused test (or modify the existing test) that:
1. Creates a call record via the incoming webhook
2. Fires `/telephony/voicemail-recording?callSid=...` with a completed recording payload
3. Queries `/api/calls/history` and asserts `hasVoicemail === true` and `recordingSid` is set

This test should NOT have conditional `if (match)` guards — it must fail loudly if persistence doesn't work.

- [ ] **Step 3: Fix the handler to extract recordingSid and persist to call_records**

In the `/voicemail-recording` handler, change:

```ts
const { status: recordingStatus } = await adapter.parseRecordingWebhook(c.req.raw)
```

To:

```ts
const { status: recordingStatus, recordingSid } = await adapter.parseRecordingWebhook(c.req.raw)
```

Then inside the `if (recordingStatus === 'completed')` block, after `updateActiveCall` and before `transcribeVoicemail`, add:

```ts
// Persist voicemail flag and recording SID to call_records
if (recordingSid) {
  await services.records
    .updateCallRecord(callSid, hubId ?? 'global', {
      hasVoicemail: true,
      hasRecording: true,
      recordingSid,
    })
    .catch((err) => console.error('[telephony] failed to persist voicemail record:', callSid, err))
}

// Store encrypted audio in MinIO and delete from provider (background)
if (recordingSid) {
  void (async () => {
    try {
      const settings = await services.settings.getCallSettings(hubId)
      // Get admin pubkeys for encryption — use getVolunteers() and filter by admin roles
      // Phase 2 will switch to querying by voicemail:listen permission
      const allVolunteers = await services.identity.getVolunteers()
      const adminPubkeys = allVolunteers
        .filter((v) => v.roles?.some((r) => r === 'role-hub-admin' || r === 'role-super-admin'))
        .map((v) => v.pubkey)
      // Also include env.ADMIN_PUBKEY as fallback
      if (env.ADMIN_PUBKEY && !adminPubkeys.includes(env.ADMIN_PUBKEY)) {
        adminPubkeys.push(env.ADMIN_PUBKEY)
      }

      await storeVoicemailAudio({
        callSid,
        recordingSid,
        hubId: hubId ?? 'global',
        adminPubkeys,
        adapter,
        files: services.files,
        records: services.records,
        maxBytes: settings.voicemailMaxBytes ?? 2097152,
      })
    } catch (err) {
      console.error('[background] voicemail storage failed:', callSid, err)
    }
  })()
}
```

Uses `services.identity.getVolunteers()` (exists at `src/server/services/identity.ts:53`) filtered by admin roles. The `env.ADMIN_PUBKEY` is included as fallback to ensure at least one recipient always exists.

- [ ] **Step 4: Run the test from Step 2**

Run: `bun run test:api`
Expected: PASS — `hasVoicemail` and `recordingSid` now persisted

- [ ] **Step 5: Run typecheck and build**

Run: `bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/telephony.ts tests/api/voicemail-webhook.spec.ts
git commit -m "fix: persist hasVoicemail and recordingSid to call_records, add encrypted audio storage"
```

---

## Task 7: Update Transcription Manager Domain Separation

**Files:**
- Modify: `src/server/lib/transcription-manager.ts`

- [ ] **Step 1: Add label parameter to encryptMessageForStorage**

`encryptMessageForStorage` in `src/server/lib/crypto.ts` (line 89) currently hardcodes `LABEL_MESSAGE` at line 110. Add an optional `label` parameter with `LABEL_MESSAGE` as default:

```ts
export function encryptMessageForStorage(
  plaintext: string,
  readerPubkeys: string[],
  label: string = LABEL_MESSAGE  // <-- add this parameter
): { encryptedContent: string; readerEnvelopes: MessageKeyEnvelope[] } {
```

Then change line 110 from:
```ts
...eciesWrapKeyServer(messageKey, pk, LABEL_MESSAGE),
```
To:
```ts
...eciesWrapKeyServer(messageKey, pk, label),
```

This is backwards-compatible — all existing callers continue using `LABEL_MESSAGE`.

- [ ] **Step 2: Use LABEL_VOICEMAIL_TRANSCRIPT in transcribeVoicemail**

In `src/server/lib/transcription-manager.ts`, find the `encryptMessageForStorage` call inside `transcribeVoicemail()` and pass `LABEL_VOICEMAIL_TRANSCRIPT`:

```ts
import { LABEL_VOICEMAIL_TRANSCRIPT } from '@shared/crypto-labels'

// In the encryptMessageForStorage call:
const encrypted = encryptMessageForStorage(transcript, adminPubkeys, LABEL_VOICEMAIL_TRANSCRIPT)
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/server/lib/transcription-manager.ts
git commit -m "feat: use LABEL_VOICEMAIL_TRANSCRIPT for voicemail transcript encryption"
```

---

## Task 8: Fix Tests

**Files:**
- Modify: `tests/api/voicemail-webhook.spec.ts`

- [ ] **Step 1: Remove conditional guards on hasVoicemail assertion**

The existing test at ~line 63 has:

```ts
if (match) {
  expect(match.hasVoicemail).toBe(true)
}
```

Change to unconditionally assert. The test should create the call record first (via the incoming webhook), then fire the voicemail-recording webhook, then query history and assert.

If the test environment can't create call records (e.g., telephony not configured), the test should be properly skipped with `test.skipIf(condition)` at the top — not silently swallowed inside a conditional.

- [ ] **Step 2: Add test for recordingSid persistence**

Add assertion that the call record in history has `recordingSid` set (not null/undefined).

- [ ] **Step 3: Add test for voicemail transcript in note_envelopes**

After the voicemail-recording webhook fires and transcription completes, query notes for the call and assert:
- A note exists with `authorPubkey === 'system:voicemail'`
- The note's `encryptedContent` is non-empty
- The note is linked to the correct `callId`

This verifies the spec requirement: "voicemail transcript exists in `note_envelopes` with `authorPubkey = 'system:voicemail'`". Note: transcription may be async — check if the test environment has faster-whisper or mock `env.AI`.

- [ ] **Step 4: Add test for voicemailFileId (encrypted storage)**

After the voicemail-recording webhook fires, the background storage job should eventually populate `voicemailFileId`. This may be hard to test synchronously since storage is async. Options:
- Mock the storage function in tests
- Add a small wait + poll
- Check MinIO directly via the FilesService

Use whichever pattern the existing test suite uses for async background operations.

- [ ] **Step 5: Run all tests**

Run: `bun run test:unit && bun run test:api`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/api/voicemail-webhook.spec.ts
git commit -m "test: fix voicemail webhook tests — remove conditional guards, add persistence assertions"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Run full build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Run all test suites**

Run: `bun run test:all`
Expected: PASS (some tests may require `bun run dev:docker` for Postgres)

- [ ] **Step 4: Commit any remaining fixes**

If any issues were found, fix and commit individually.
