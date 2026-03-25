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
| `src/shared/crypto-labels.ts` | Add `LABEL_VOICEMAIL_AUDIO` and `LABEL_VOICEMAIL_TRANSCRIPT` |
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
export const LABEL_VOICEMAIL_AUDIO = 'llamenos:voicemail-audio'

/** Voicemail transcript encryption */
export const LABEL_VOICEMAIL_TRANSCRIPT = 'llamenos:voicemail-transcript'
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/shared/crypto-labels.ts
git commit -m "feat: add LABEL_VOICEMAIL_AUDIO and LABEL_VOICEMAIL_TRANSCRIPT crypto labels"
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

- [ ] **Step 5: Update CreateCallRecordData type if needed**

Check `src/server/types.ts` for `CreateCallRecordData` — ensure `voicemailFileId` is included. If the type is derived from the schema, it may auto-update. If manually defined, add `voicemailFileId?: string`.

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

The existing `encryptMessageForStorage()` handles string plaintext. Voicemail audio is binary (`Uint8Array`). We need a server-side function that encrypts binary data with the ECIES envelope pattern, using `LABEL_VOICEMAIL_AUDIO` for domain separation.

- [ ] **Step 1: Write failing test for binary encryption**

```ts
import { describe, expect, test } from 'bun:test'
import { encryptBinaryForStorage, decryptBinaryFromStorage } from './crypto'
import { LABEL_VOICEMAIL_AUDIO } from '@shared/crypto-labels'

describe('encryptBinaryForStorage', () => {
  test('encrypts and decrypts binary data for a recipient', async () => {
    const { schnorr } = await import('@noble/curves/secp256k1')
    const privkey = schnorr.utils.randomPrivateKey()
    const pubkey = Buffer.from(schnorr.getPublicKey(privkey)).toString('hex')

    const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const result = encryptBinaryForStorage(plaintext, [pubkey], LABEL_VOICEMAIL_AUDIO)

    expect(result.encryptedContent).toBeDefined()
    expect(result.readerEnvelopes).toHaveLength(1)
    expect(result.readerEnvelopes[0].pubkey).toBe(pubkey)

    // Decrypt
    const decrypted = decryptBinaryFromStorage(
      result.encryptedContent,
      result.readerEnvelopes[0],
      privkey,
      LABEL_VOICEMAIL_AUDIO
    )
    expect(decrypted).toEqual(plaintext)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/lib/crypto.test.ts`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement encryptBinaryForStorage**

In `src/server/lib/crypto.ts`, add a new exported function. Follow the same pattern as `encryptMessageForStorage` but accept `Uint8Array` input and return hex-encoded ciphertext:

```ts
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/ciphers/webcrypto.js'

export function encryptBinaryForStorage(
  plaintext: Uint8Array,
  readerPubkeys: string[],
  label: string
): { encryptedContent: string; readerEnvelopes: FileKeyEnvelope[] } {
  // Generate random 32-byte symmetric key
  const fileKey = randomBytes(32)
  const nonce = randomBytes(24)
  const cipher = xchacha20poly1305(fileKey, nonce)
  const ciphertext = cipher.encrypt(plaintext)
  // Store as: nonce(24) || ciphertext
  const combined = new Uint8Array(24 + ciphertext.length)
  combined.set(nonce, 0)
  combined.set(ciphertext, 24)
  const encryptedContent = Buffer.from(combined).toString('hex')

  // Wrap key for each reader
  const readerEnvelopes: FileKeyEnvelope[] = readerPubkeys.map((pubkey) => {
    return eciesWrapKeyServer(fileKey, pubkey, label)
  })

  return { encryptedContent, readerEnvelopes }
}
```

Also export a matching `decryptBinaryFromStorage` for testing and future playback:

```ts
export function decryptBinaryFromStorage(
  encryptedContentHex: string,
  envelope: FileKeyEnvelope,
  privateKey: Uint8Array,
  label: string
): Uint8Array {
  const fileKey = eciesUnwrapKeyServer(envelope, privateKey, label)
  const combined = Buffer.from(encryptedContentHex, 'hex')
  const nonce = combined.subarray(0, 24)
  const ciphertext = combined.subarray(24)
  const cipher = xchacha20poly1305(fileKey, nonce)
  return cipher.decrypt(ciphertext)
}
```

Note: `eciesWrapKeyServer` is currently a private function in crypto.ts. You may need to either make it non-private or call it within the same file. Check if `eciesUnwrapKeyServer` exists — if not, implement it following the ECIES pattern (SharedSecret via ECDH, HKDF derive key, decrypt).

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

  test('rejects audio exceeding maxBytes', async () => {
    const bigAudio = new Uint8Array(3_000_000) // 3MB > 2MB default
    const mockAdapter = {
      getRecordingAudio: mock(async () => bigAudio.buffer as ArrayBuffer),
      deleteRecording: mock(async () => {}),
    }

    await expect(storeVoicemailAudio({
      callSid: 'CA123',
      recordingSid: 'REC456',
      hubId: 'hub-1',
      adminPubkeys: ['aabbcc'],
      adapter: mockAdapter as any,
      files: { createFileRecord: mock(), putAssembled: mock(), completeUpload: mock() } as any,
      records: { updateCallRecord: mock() } as any,
      maxBytes: 2097152,
    })).rejects.toThrow(/exceeds maximum/)

    // Provider copy should NOT be deleted when storage fails
    expect(mockAdapter.deleteRecording).not.toHaveBeenCalled()
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
import { LABEL_VOICEMAIL_AUDIO } from '@shared/crypto-labels'
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

export async function storeVoicemailAudio(params: StoreVoicemailParams): Promise<string> {
  const { callSid, recordingSid, hubId, adminPubkeys, adapter, files, records, maxBytes } = params

  // 1. Download audio from provider
  const audioBuffer = await adapter.getRecordingAudio(recordingSid)
  if (!audioBuffer) {
    throw new Error(`Failed to download recording ${recordingSid} for call ${callSid}`)
  }

  const audioBytes = new Uint8Array(audioBuffer)

  // 2. Validate size
  if (audioBytes.length > maxBytes) {
    throw new Error(
      `Voicemail audio (${audioBytes.length} bytes) exceeds maximum (${maxBytes} bytes) for call ${callSid}`
    )
  }

  // 3. Encrypt audio with ECIES envelopes for each admin
  const { encryptedContent, readerEnvelopes } = encryptBinaryForStorage(
    audioBytes,
    adminPubkeys,
    LABEL_VOICEMAIL_AUDIO
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

- [ ] **Step 1: Fix the handler to extract recordingSid and persist to call_records**

In `src/server/routes/telephony.ts`, the `/voicemail-recording` handler currently:

```ts
const { status: recordingStatus } = await adapter.parseRecordingWebhook(c.req.raw)
```

Change to:

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
  import('../lib/voicemail-storage').then(({ storeVoicemailAudio }) => {
    const callSettings = services.settings.getCallSettings(hubId)
    callSettings.then(async (settings) => {
      // Get admin pubkeys for encryption envelopes
      const members = await services.identity.getHubMembers(hubId ?? 'global')
      const adminPubkeys = members
        .filter((m) => m.roles.some((r) => r === 'role-hub-admin' || r === 'role-super-admin'))
        .map((m) => m.pubkey)

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
    })
  }).catch((err) => console.error('[background] voicemail storage failed:', callSid, err))
}
```

Note: The admin pubkey lookup uses `services.identity.getHubMembers()` — verify this method exists and returns role info. Phase 2 will switch to querying by `voicemail:listen` permission. For now, filtering by admin roles is correct per the spec.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Run build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/telephony.ts
git commit -m "fix: persist hasVoicemail and recordingSid to call_records, add encrypted audio storage"
```

---

## Task 7: Update Transcription Manager Domain Separation

**Files:**
- Modify: `src/server/lib/transcription-manager.ts`

- [ ] **Step 1: Use LABEL_VOICEMAIL_TRANSCRIPT for voicemail transcripts**

In `transcribeVoicemail()`, find the `encryptMessageForStorage` call and ensure it uses the new voicemail-specific label instead of the generic message label.

Check the current call — it likely passes admin pubkeys but uses `LABEL_MESSAGE` by default. Change the label parameter to `LABEL_VOICEMAIL_TRANSCRIPT`.

If `encryptMessageForStorage` doesn't accept a label parameter, add one (with `LABEL_MESSAGE` as default for backwards compatibility).

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

- [ ] **Step 3: Add test for voicemailFileId (encrypted storage)**

After the voicemail-recording webhook fires, the background storage job should eventually populate `voicemailFileId`. This may be hard to test synchronously since storage is async. Options:
- Mock the storage function in tests
- Add a small wait + poll
- Check MinIO directly via the FilesService

Use whichever pattern the existing test suite uses for async background operations.

- [ ] **Step 4: Run all tests**

Run: `bun run test:unit && bun run test:api`
Expected: PASS

- [ ] **Step 5: Commit**

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
