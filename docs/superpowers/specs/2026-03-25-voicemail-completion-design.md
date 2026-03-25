# Voicemail Completion Design

**Date:** 2026-03-25
**Status:** Approved
**Scope:** Complete the partially-implemented voicemail feature — fix persistence bugs, add encrypted audio storage, voicemail-only mode, permissions, notifications, and playback UI.

## Context

The voicemail feature has a solid skeleton (DB schema, adapter methods, call routing, transcription pipeline, UI badge) but was never completed end-to-end. Critical gaps:

- `hasVoicemail` and `recordingSid` are never persisted to `call_records` (only the ephemeral `active_calls` table is updated)
- Voicemail audio lives exclusively on the telephony provider — not encrypted, not stored in operator-controlled infrastructure
- No voicemail-specific permissions, notifications, or playback UI
- Some hotlines will operate as **voicemail-only** (no live volunteers), making voicemail a primary interaction mode, not just a fallback

### Security Constraint

Voicemail audio must be encrypted at rest in operator-controlled storage (MinIO). After encryption and storage, the provider's copy must be deleted immediately. Audio must never linger on third-party servers. This aligns with the project's threat model (nation-state adversaries, GDPR).

## Design

Three phases, each independently testable and shippable.

---

## Phase 1: Fix the Foundation

### 1.1 Persistence Bug Fix

The `/voicemail-recording` webhook handler in `src/server/routes/telephony.ts` currently only calls `updateActiveCall()` (ephemeral). It must also call:

```ts
await services.records.updateCallRecord(callSid, hubId, {
  hasVoicemail: true,
  recordingSid,
})
```

Each adapter's `parseRecordingWebhook()` must surface the recording SID in its return value. The handler extracts it alongside `recordingStatus`.

### 1.2 Encrypted Audio Storage

**Flow after recording webhook fires:**

1. `adapter.getRecordingAudio(recordingSid)` → raw audio bytes (`ArrayBuffer`)
2. Encrypt audio using the existing `FilesService` encrypted file upload pattern (binary-aware, uses `FileKeyEnvelope` envelopes and chunk-based blob storage). This reuses the same infrastructure as user file uploads — no new encryption function needed.
3. `FilesService` uploads encrypted blob to MinIO with metadata and recipient envelopes
4. `adapter.deleteRecording(recordingSid)` → remove from provider
5. `updateCallRecord(callSid, hubId, { hasVoicemail: true, voicemailFileId })`

**Recipients for voicemail encryption:**
- **Audio envelopes:** Users with `voicemail:listen` permission in the hub (in Phase 1, before permissions exist, all hub admins with `calls:*`). Phase 2 switches to querying by `voicemail:listen`.
- **Transcript envelopes:** Users with `voicemail:read` OR `voicemail:listen` permission. This means `voicemail:read` users can decrypt and view the transcript without being able to decrypt the audio. The existing `encryptMessageForStorage()` call in `transcribeVoicemail()` must be updated to include `voicemail:read` recipients in addition to admins.

**New crypto labels** in `src/shared/crypto-labels.ts`:
- `LABEL_VOICEMAIL_WRAP` — domain separation for voicemail audio encryption (used instead of `LABEL_FILE_KEY` to distinguish voicemail blobs from user-uploaded files)
- `LABEL_VOICEMAIL_TRANSCRIPT` — domain separation for voicemail transcript encryption (replaces the generic `LABEL_MESSAGE` currently used by `transcribeVoicemail()`)

**Adapter interface addition:**

```ts
deleteRecording(recordingSid: string): Promise<void>
```

Implemented per adapter:
- **Twilio:** DELETE `https://api.twilio.com/2010-04-01/Accounts/{sid}/Recordings/{recordingSid}.json`
- **SignalWire:** Same as Twilio (API-compatible)
- **Plivo:** DELETE `https://api.plivo.com/v1/Account/{authId}/Recording/{recordingId}/`
- **Vonage:** DELETE `https://api.nexmo.com/v3/media/{id}` via the Vonage Media API. Note: Vonage stores `recording_url` (a full download URL) rather than a discrete recording SID. The media `:id` must be extracted from the recording URL or looked up via `GET https://api.nexmo.com/v3/media/` with the account filter. Auth via JWT or Basic (API key:secret).
- **Asterisk:** DELETE `http://asterisk-bridge/recordings/{recordingName}` (new bridge endpoint, see Phase 3)
- **TestAdapter:** No-op, tracks deletion in test state

**Configurable limits** (additions to `call_settings`):
- `voicemailMaxBytes: integer` — max audio file size, default 2MB (sufficient for 120s compressed audio)
- `callRecordingMaxBytes: integer` — max bridged call recording size, default 20MB
- Validation on upload: if over limit, log error and keep provider copy as fallback rather than silently losing the recording

### 1.3 Faster-Whisper Wiring

`env.AI` on VPS must resolve to the existing faster-whisper container. Implementation:

- A `WhisperHttpClient` class implementing the `TranscriptionService` interface
- POSTs audio to the faster-whisper container's endpoint (already deployed in Docker Compose)
- Wired in server startup: if `WHISPER_URL` env var is set, `env.AI` is set to a `WhisperHttpClient` instance that proxies `run()` calls to the faster-whisper HTTP endpoint. If `WHISPER_URL` is not set, falls back to CF Workers AI binding (demo/edge deployments).
- The existing `transcribeVoicemail()` function is unchanged — it calls `env.AI.run()` which resolves to the right backend transparently

### 1.4 Test Fixes

- Remove conditional `if (match)` guards in `tests/api/voicemail-webhook.spec.ts` — assert `hasVoicemail === true` unconditionally
- Add test: webhook → encrypted audio blob exists in MinIO → provider recording deleted
- Add test: voicemail transcript exists in `note_envelopes` with `authorPubkey = 'system:voicemail'`
- Add test: `recordingSid` persisted on `call_records`

---

## Phase 2: Voicemail-Only Mode + Permissions

### 2.1 Permission Domain

New permissions in `PERMISSION_CATALOG` (`src/shared/permissions.ts`):

| Permission | Description |
|---|---|
| `voicemail:listen` | Play/decrypt voicemail audio |
| `voicemail:read` | View voicemail metadata (caller, duration, timestamp) in call history |
| `voicemail:notify` | Receive real-time and push notifications for new voicemails |
| `voicemail:delete` | Delete voicemail audio + transcript |
| `voicemail:manage` | Configure voicemail settings (limits, prompts, retention) |

**Default role updates:**
- **Hub Admin:** add `voicemail:*` (Hub Admin already has `calls:*`; adding `voicemail:*` explicitly ensures voicemail access survives if `calls:*` is ever narrowed on a custom role. Phase 1 uses `calls:*` for encryption recipients; Phase 2 switches to `voicemail:listen`.)
- **Volunteer:** add `voicemail:read` + `calls:read-history` (volunteers need `calls:read-history` to see the call history list where voicemail badges appear; `voicemail:read` gates the voicemail-specific metadata and transcript within that list)

**New default role — Voicemail Reviewer:**

```ts
{
  id: 'role-voicemail-reviewer',
  name: 'Voicemail Reviewer',
  slug: 'voicemail-reviewer',
  permissions: [
    'voicemail:listen',
    'voicemail:read',
    'voicemail:notify',
    'notes:read-all',
    'contacts:read',
    'calls:read-history',
  ],
  isDefault: true,
  isSystem: false,
  description: 'Triages voicemails — listens, reads transcripts, and receives notifications',
}
```

### 2.2 Voicemail-Only Mode

**New setting** in `call_settings`:

```ts
voicemailMode: 'auto' | 'always' | 'never'  // default: 'auto'
```

Behavior:
- **`auto`** — Normal routing. But if `ShiftManagerService.getEffectiveVolunteers(hubId)` returns zero AND `SettingsService.getFallbackGroup(hubId)` is also empty (matching the existing logic in `startParallelRinging` in `src/server/lib/ringing.ts`), skip enqueue entirely and go straight to `adapter.handleVoicemail()`.
- **`always`** — Every call goes to voicemail after the language menu + spam check. No ringing, no queue.
- **`never`** — If nobody is available, play a "sorry, try again later" message and hang up. No voicemail.

**Implementation point:** In the `/telephony/language-selected` handler, after spam check passes, before `startParallelRinging`:

```ts
const onShift = await services.shifts.getEffectiveVolunteers(hubId)
const fallback = onShift.length === 0 ? await services.settings.getFallbackGroup(hubId) : onShift
const settings = await services.settings.getCallSettings(hubId)

if (settings.voicemailMode === 'always' ||
    (settings.voicemailMode === 'auto' && fallback.length === 0)) {
  return telephonyResponse(await adapter.handleVoicemail({ ... }))
}
if (settings.voicemailMode === 'never' && fallback.length === 0) {
  // New adapter method: handleUnavailable(lang, audioUrls)
  // Returns TwiML/NCCO that says "sorry, no one is available" and hangs up
  return telephonyResponse(adapter.handleUnavailable(lang, audioUrls))
}
// else: normal enqueue + startParallelRinging
```

**New adapter interface method:**
```ts
handleUnavailable(lang: string, audioUrls?: Record<string, string>): TelephonyResponse
```
Returns provider-appropriate response that plays an "unavailable" message and hangs up. Uses the configurable `unavailableMessage` IVR audio (new prompt type in `voice-prompts.ts`).

The voicemail prompt is already configurable per-hub via the `ivrAudio` table — admins can set distinct prompts for voicemail-only vs fallback scenarios by customizing the `voicemailPrompt` audio.

### 2.3 Configurable Limits

Additions to `call_settings`:

| Setting | Type | Default | Description |
|---|---|---|---|
| `voicemailMaxSeconds` | integer | 120 | Already exists — max recording duration |
| `voicemailMaxBytes` | integer | 2097152 (2MB) | Max audio file size for storage |
| `callRecordingMaxBytes` | integer | 20971520 (20MB) | Max bridged call recording file size |
| `voicemailRetentionDays` | integer \| null | null | Auto-purge after N days; null = keep forever |

Retention enforcement is a background cron job — setting is added in this phase, purge job implementation is deferred (can be a simple scheduled task that queries `call_records WHERE hasVoicemail = true AND createdAt < now() - retentionDays`). The setting should be visible in admin UI with a "(purge job not yet active)" note until the job is implemented.

---

## Phase 3: Notifications + Playback UI + Asterisk

### 3.1 Voicemail Notifications via Nostr Relay

When voicemail audio is encrypted and stored (end of Phase 1 flow):

1. Server publishes a `KIND_CALL_VOICEMAIL` (1002) event to strfry, encrypted with the hub key. Uses kind 1002 (regular/persisted, not ephemeral) so clients coming online later can still see pending voicemail notifications.
2. Decrypted content: `{ type: 'voicemail:new', callId, hubId, callerLast4, duration, timestamp }`
3. Generic tag `["t", "llamenos:event"]` — relay cannot distinguish event types (existing pattern)
4. Dashboard clients receive the event and show a voicemail notification badge/toast if the current user has `voicemail:notify` permission (client-side permission check)

### 3.2 Web Push Notifications

Uses the existing `push_subscriptions` table and Web Push infrastructure:

1. After voicemail storage, server queries users with `voicemail:notify` permission in the hub who have push subscriptions
2. Server sends Web Push notification via VAPID — payload is minimal: `{ title: "New voicemail", body: "New voicemail received", hubId }` — no caller info in push payload (security)
3. Clicking the notification opens the dashboard to call history filtered to voicemails
4. PWA service worker handles the push event via existing Workbox setup

**User opt-in:** Push notification subscription is already a user-level setting. No new UI needed for the subscription flow itself — just the server-side logic to fire voicemail-specific pushes.

### 3.3 Voicemail Playback UI

**New API endpoint:**

`GET /api/calls/:callId/voicemail` — returns encrypted audio blob + recipient envelope for the requesting user. Requires `voicemail:listen` permission.

**VoicemailPlayer component:**

1. Fetch encrypted audio + envelope from API
2. Decrypt symmetric key via ECIES using user's local private key
3. Decrypt audio with XChaCha20-Poly1305
4. Render audio player: play/pause, scrubber, duration display
5. Show decrypted transcript below the player (from `note_envelopes` where `authorPubkey = 'system:voicemail'`)

**Permission-gated rendering:**
- `voicemail:listen` → full player + transcript
- `voicemail:read` only → metadata (caller last 4, duration, timestamp) + transcript, no audio playback

**Call history UI updates:**
- Voicemail badge (already in `calls.tsx`) becomes functional once `hasVoicemail` is persisted (Phase 1)
- Badge click opens voicemail detail view/modal with `VoicemailPlayer`
- Add "Voicemails only" filter to call history

### 3.4 Asterisk Bridge Recording Endpoint

The asterisk-bridge needs two new HTTP endpoints:

- `GET /recordings/:recordingName` — returns raw audio from Asterisk's ARI recording storage
- `DELETE /recordings/:recordingName` — deletes recording after app server has encrypted and stored it

Auth: existing shared HMAC secret between app server and bridge.

The `AsteriskAdapter.getRecordingAudio()` and `deleteRecording()` methods call these bridge endpoints. Same encrypt → store → delete flow as cloud providers (per design decision to keep all encryption in the app server, not the bridge).

### 3.5 Provider Voicemail Disablement Guide

Operational documentation in `docs/operations/disable-provider-voicemail.md`:

- **Twilio:** Disable voicemail in console per-number; ensure no Studio flows intercept unanswered calls
- **Plivo:** Disable carrier voicemail; configure number to always forward to webhook
- **Vonage:** Disable Vonage voicemail feature on number settings
- **SignalWire:** Same as Twilio (API-compatible)
- **Asterisk:** Controlled entirely by dialplan — no built-in voicemail app unless explicitly configured

---

## Files Affected

### Modified
- `src/server/routes/telephony.ts` — persistence bug fix, voicemail-only routing, notification dispatch
- `src/server/telephony/adapter.ts` — `deleteRecording()` and `handleUnavailable()` interface additions
- `src/server/telephony/twilio.ts` — `deleteRecording()` implementation
- `src/server/telephony/plivo.ts` — `deleteRecording()` implementation
- `src/server/telephony/vonage.ts` — `deleteRecording()` implementation
- `src/server/telephony/signalwire.ts` — `deleteRecording()` + `getRecordingAudio()` + `handleUnavailable()` (SignalWire extends Twilio adapter — verify inheritance covers these or add explicit implementations)
- `src/server/telephony/asterisk.ts` — `deleteRecording()` + `getRecordingAudio()` via bridge
- `src/server/telephony/test.ts` — `deleteRecording()` test stub
- `src/server/lib/transcription-manager.ts` — wire to faster-whisper on VPS
- `src/server/db/schema/settings.ts` — new `call_settings` columns
- `src/server/db/schema/records.ts` — `voicemailFileId` on `call_records` if needed
- `src/server/services/settings.ts` — new settings accessors
- `src/server/services/records.ts` — voicemail record updates
- `src/shared/permissions.ts` — `voicemail:*` domain, Voicemail Reviewer role
- `src/shared/crypto-labels.ts` — `LABEL_VOICEMAIL_WRAP`, `LABEL_VOICEMAIL_TRANSCRIPT`
- `src/shared/voice-prompts.ts` — new `unavailableMessage` prompt for `voicemailMode: 'never'`
- `src/server/lib/ringing.ts` — voicemail-only check before parallel ringing
- `src/client/routes/calls.tsx` — voicemail filter, badge click behavior
- `tests/api/voicemail-webhook.spec.ts` — fix conditional guards, add storage tests

### New
- `src/server/routes/voicemail.ts` — voicemail playback API endpoint
- `src/client/components/voicemail-player.tsx` — decryption + playback UI
- `docs/operations/disable-provider-voicemail.md` — provider setup guide

### Migrations
- New Drizzle migration for `call_settings` additions (`voicemailMode`, `voicemailMaxBytes`, `callRecordingMaxBytes`, `voicemailRetentionDays`) and `call_records.voicemail_file_id`

---

## Non-Goals

- Voicemail-to-email (not needed — notifications go through Web Push + Nostr relay)
- Voicemail greeting recording via phone (admin uploads custom audio via existing IVR audio UI)
- Voicemail retention purge job implementation (setting added, job deferred)
- Provider-side programmatic voicemail disablement (documented as manual operational step)
