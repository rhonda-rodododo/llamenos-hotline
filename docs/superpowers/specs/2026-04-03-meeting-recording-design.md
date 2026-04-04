# Spec 3: Meeting Recording & Playback with E2EE

**Status:** Deferred
**Date:** 2026-04-03
**Dependencies:** Spec 1 (LiveKit Infrastructure), Spec 2 (Meeting Lifecycle)
**Blocked by:** VideoAdapter + meeting lifecycle must exist

## Context

Training recordings are essential — attendees who miss a session need async access. Recordings must follow the zero-knowledge model: per-meeting envelope encryption, where only designated recipients (host, presenters, admins) can decrypt. The server never holds plaintext recording content.

## The E2EE Recording Tension

With SFrame E2EE enabled, the SFU only forwards encrypted media it cannot decrypt. LiveKit Egress (server-side recording) cannot composite what it cannot see. The solution:

### Hybrid Approach: Keyed Recording Participant

LiveKit supports this natively. When recording starts:

1. LiveKit Egress joins the room as a participant
2. Egress receives the E2EE session key via LiveKit's key distribution protocol (same as any participant)
3. Egress decrypts media frames in memory for compositing
4. Participants see "Recording has started" notification — can leave if they don't consent
5. The composited output exists briefly in Egress memory
6. Output is envelope-encrypted before touching persistent storage

The SFU itself still cannot read media — only the Egress participant (with key access) and real participants can. This is the standard LiveKit E2EE + Egress pattern.

For meetings with E2EE disabled: Egress works normally without needing key access. The output is still envelope-encrypted before storage.

## Recording Pipeline

### Start Recording

1. Host triggers "Start Recording" → `POST /api/meetings/:id/recording/start`
2. Server verifies host has `meeting:record` permission
3. Server calls `VideoAdapter.startRecording()` with options:
   - Layout: `speaker` (default for webinar) or `grid`
   - Format: `mp4` (default) or `webm`
   - Audio-only option for bandwidth-constrained situations
4. LiveKit Egress spins up, joins room, begins compositing
5. Server stores `egressId` on meeting record
6. Publishes `meeting:recording:started` Nostr event
7. All participants see recording indicator in UI

### Stop Recording

1. Host triggers "Stop Recording" OR meeting ends → `POST /api/meetings/:id/recording/stop`
2. Server calls `VideoAdapter.stopRecording()`
3. Egress finalizes the media file and makes it available via callback
4. Post-processing begins (see Encryption below)
5. Publishes `meeting:recording:stopped` Nostr event

### Post-Processing: Encryption & Storage

When Egress completes and the raw recording is available:

1. **Generate per-recording symmetric key** — `crypto.getRandomValues(new Uint8Array(32))`
2. **Encrypt recording** — XChaCha20-Poly1305 with the random key. For large files, use chunked encryption with sequential nonces (64KB chunks, nonce incremented per chunk). This enables streaming decryption on playback.
3. **Wrap key via ECIES** — create an envelope for each authorized recipient:
   - Meeting host (always)
   - All presenters at time of recording
   - All hub admins
   - Domain separation label: `LABEL_RECORDING_KEY_WRAP` (new constant in `crypto-labels.ts`)
4. **Upload to RustFS** — encrypted recording + envelope metadata stored at:
   ```
   {hubId}-recordings/{meetingId}/{recordingId}.enc
   {hubId}-recordings/{meetingId}/{recordingId}.envelopes.json
   ```
5. **Zero raw file** — Egress temp storage wiped
6. **Create recording record** in database (see Data Model)

### Data Model

#### `meeting_recordings` Table

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
hub_id          uuid NOT NULL REFERENCES hubs(id)
meeting_id      uuid NOT NULL REFERENCES meetings(id)
egress_id       text NOT NULL                -- LiveKit egress ID
status          text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed', 'deleted'))
duration_secs   integer
file_size_bytes bigint
format          text NOT NULL CHECK (format IN ('mp4', 'webm'))
layout          text NOT NULL CHECK (layout IN ('speaker', 'grid'))
audio_only      boolean NOT NULL DEFAULT false
storage_path    text                         -- RustFS path, set when upload completes
created_at      timestamptz NOT NULL DEFAULT now()
expires_at      timestamptz                  -- retention policy expiry
pinned          boolean NOT NULL DEFAULT false -- admin can pin to prevent auto-deletion
```

#### `recording_envelopes` Table

```sql
recording_id    uuid NOT NULL REFERENCES meeting_recordings(id) ON DELETE CASCADE
recipient_pubkey text NOT NULL               -- who can decrypt
encrypted_key   text NOT NULL                -- ECIES-wrapped symmetric key
UNIQUE(recording_id, recipient_pubkey)
```

## Playback

### Flow

1. User navigates to meeting detail → sees "Recording available"
2. Client fetches recording metadata: `GET /api/meetings/:id/recordings`
3. Client fetches their envelope: `GET /api/meetings/:id/recordings/:recordingId/envelope`
4. Client unwraps the symmetric key using their private key (via crypto worker)
5. Client fetches encrypted recording: `GET /api/meetings/:id/recordings/:recordingId/stream`
6. **Streaming decryption** — client decrypts chunks as they arrive, feeds to `<video>` element via `MediaSource` API
7. Decrypted content never touches disk — exists only in memory during playback

### Streaming Decryption Detail

The recording is encrypted in 64KB chunks with sequential nonces. The client:

1. Reads the chunk header (nonce)
2. Decrypts the chunk with XChaCha20-Poly1305
3. Appends decrypted data to a `SourceBuffer` on a `MediaSource` object
4. The `<video>` element plays from the `MediaSource`

This avoids downloading and decrypting the entire recording before playback. Users see video start within seconds.

### Offline/Download

For offline viewing:
1. Client decrypts the entire recording to an in-memory blob
2. Creates an object URL for download
3. Downloaded file is plaintext — user's responsibility to protect it
4. UI warns: "This file will not be encrypted on your device"

## Retention Policy

- Default retention: 90 days (configurable per hub via settings)
- Admins can pin recordings to prevent auto-deletion
- StorageManager lifecycle rules enforce retention:
  - New namespace: `recordings` (alongside `voicemails`, `attachments`)
  - Lifecycle policy set per hub when provisioning
- Expired recordings: storage object deleted, database record marked `status: 'deleted'`, envelopes removed
- Audit event logged on deletion: `recording:expired` or `recording:deleted`

## Recipient Management

### Adding Recipients After Recording

Admins can grant access to additional users after a recording is made. The key constraint: the server must never see the symmetric key. All re-wrapping happens client-side:
1. Admin's client fetches their own envelope, unwraps the symmetric key
2. Client re-wraps the key for the new recipient's pubkey via ECIES
3. Client sends the new envelope to the server: `POST /api/meetings/:id/recordings/:recordingId/envelopes`
4. Server stores the new envelope — never sees the symmetric key

Same pattern as adding a reader to an encrypted note.

### Revoking Access

1. Remove the recipient's envelope from `recording_envelopes`
2. The recipient can no longer unwrap the key
3. If they previously downloaded the file, revocation doesn't help — this is inherent to any E2EE system
4. Audit event: `recording:access:revoked`

## API Routes

```
GET    /api/meetings/:id/recordings                          — list recordings for a meeting
GET    /api/meetings/:id/recordings/:recordingId             — recording metadata
GET    /api/meetings/:id/recordings/:recordingId/envelope    — get requester's envelope
GET    /api/meetings/:id/recordings/:recordingId/stream      — stream encrypted recording bytes
POST   /api/meetings/:id/recordings/:recordingId/envelopes   — add recipient envelope
DELETE /api/meetings/:id/recordings/:recordingId/envelopes/:pubkey — revoke access
DELETE /api/meetings/:id/recordings/:recordingId             — delete recording (admin only)
```

## Crypto Labels

New constants added to `src/shared/crypto-labels.ts`:

```typescript
export const LABEL_RECORDING_KEY_WRAP = 'llamenos:recording:key-wrap';
export const LABEL_RECORDING_CHUNK = 'llamenos:recording:chunk';
```

## Audit Events

```
recording:started   — recording began (actor: host, metadata: meetingId, egressId)
recording:stopped   — recording ended (actor: host or system)
recording:ready     — post-processing complete, recording available
recording:failed    — post-processing failed
recording:accessed  — someone streamed/downloaded a recording (actor: viewer)
recording:shared    — new recipient envelope added (actor: admin, metadata: recipientPubkey)
recording:revoked   — recipient access removed (actor: admin, metadata: recipientPubkey)
recording:deleted   — recording permanently deleted (actor: admin or retention policy)
recording:expired   — recording removed by retention policy (actor: system)
```
