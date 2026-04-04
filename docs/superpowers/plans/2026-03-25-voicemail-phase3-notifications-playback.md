# Voicemail Phase 3: Notifications + Playback UI + Asterisk — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time voicemail notifications (Nostr relay + Web Push), voicemail audio playback with client-side decryption, expose `voicemailFileId` in the call history API, and write the provider voicemail disablement guide.

**Architecture:** When voicemail audio is encrypted and stored (end of Phase 1 flow in `/voicemail-recording` handler), the server publishes a `KIND_CALL_VOICEMAIL` (1002) Nostr event encrypted with the hub key, and sends Web Push notifications to users with `voicemail:notify` permission. The client plays back voicemail audio by fetching the encrypted blob from the existing files API (`GET /files/:id/content` + `GET /files/:id/envelopes`), decrypting with the user's private key, and rendering an audio player with the decrypted voicemail transcript below.

**Note on Nostr event kind:** The spec says "kind 20001 (ephemeral)" but `KIND_CALL_VOICEMAIL` is defined as 1002 (regular/persisted) in the codebase. Using 1002 is correct — voicemail notifications should be persisted so clients coming online later can see them. The spec should be updated.

**Note on Asterisk bridge:** The adapter methods (`getRecordingAudio`, `deleteRecording`) call bridge endpoints (`GET /recordings/:id`, `DELETE /recordings/:id`) via the `BridgeClient`. These endpoints must exist in the sip-bridge service (a separate codebase/repo). If the bridge doesn't implement them yet, the adapter calls will fail gracefully (try/catch). This plan does NOT include changes to the sip-bridge service itself.

**Tech Stack:** Same as Phases 1-2 plus `web-push` (already installed), Nostr relay (strfry, already running), XChaCha20-Poly1305 client-side decryption.

**Spec:** `docs/superpowers/specs/2026-03-25-voicemail-completion-design.md` (Phase 3)

**Depends on:** Phase 1 (storage) + Phase 2 (permissions, voicemail mode) complete.

**Key discoveries:**
- `KIND_CALL_VOICEMAIL = 1002` is already reserved in `src/shared/nostr-events.ts`
- `'voicemail'` is already a `PushNotificationType` in `src/server/types.ts`
- `publishNostrEvent()` in `src/server/lib/nostr-events.ts` handles hub-key encryption
- `PushService.sendPushToVolunteers()` exists with the exact pattern needed
- `decryptFile()` in `src/client/lib/file-crypto.ts` handles client-side blob decryption
- `voicemailFileId` is on the server `CallRecord` type but NOT exposed to the client API

---

## File Structure

### Modified
| File | Responsibility |
|---|---|
| `src/server/routes/telephony.ts` | Publish Nostr event + send Web Push after voicemail storage |
| `src/server/routes/calls.ts` | New `GET /calls/:callId/voicemail` endpoint for encrypted audio |
| `src/server/services/records.ts` | Expose `voicemailFileId` in call record API responses |
| `src/client/routes/calls.tsx` | Voicemail badge opens player instead of notes link; add voicemail filter |
| `src/client/components/recording-player.tsx` | Add `voicemailFileId` prop for encrypted playback mode |

### New
| File | Responsibility |
|---|---|
| `src/client/components/voicemail-player.tsx` | Voicemail playback component: fetch encrypted blob → decrypt → audio player + transcript |
| `docs/operations/disable-provider-voicemail.md` | Operational guide for disabling provider-native voicemail |

---

## Task 1: Publish Nostr Event + Web Push on Voicemail Storage

**Files:**
- Modify: `src/server/routes/telephony.ts`

- [ ] **Step 1: Add imports**

At the top of `telephony.ts`, add:

```ts
import { publishNostrEvent } from '../lib/nostr-events'
import { KIND_CALL_VOICEMAIL } from '@shared/nostr-events'
```

- [ ] **Step 2: Publish Nostr event after voicemail storage**

In the `/voicemail-recording` handler, inside the `void (async () => { ... })()` background block (after `storeVoicemailAudio` succeeds), add:

```ts
// Publish voicemail Nostr event (hub-key encrypted, fire-and-forget — returns void)
publishNostrEvent(env, KIND_CALL_VOICEMAIL, {
  type: 'call:voicemail',
  callSid,
  hubId: hubId ?? 'global',
  timestamp: Date.now(),
}, hubId)
```

Follow the pattern in `src/server/lib/ringing.ts` line 81 where `KIND_CALL_RING` is published.

- [ ] **Step 3: Send Web Push to voicemail:notify users**

After the Nostr event, add push notification. Uses `services.push.sendPushToVolunteers`:

```ts
// Send push to users with voicemail:notify permission
const roleDefs = await services.identity.getRoles()
const notifyPubkeys = allVolunteers
  .filter((v) => {
    const perms = resolvePermissions(v.roles, roleDefs)
    return permissionGranted(perms, 'voicemail:notify')
  })
  .map((v) => v.pubkey)

if (notifyPubkeys.length > 0) {
  await services.push.sendPushToVolunteers(
    notifyPubkeys,
    { type: 'voicemail', callSid, hubId: hubId ?? 'global' },
    env
  ).catch((err) => console.error('[push] voicemail notification failed:', err))
}
```

Note: `allVolunteers` and `roleDefs` are already fetched earlier in this block (from Phase 2's encryption recipient logic). Reuse them.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/telephony.ts
git commit -m "feat: publish Nostr event and Web Push on new voicemail"
```

---

## Task 2: Expose voicemailFileId in Call History API

**Files:**
- Modify: `src/server/services/records.ts` or `src/server/routes/calls.ts`
- Modify: `src/client/lib/api.ts`

- [ ] **Step 1: Expose voicemailFileId in call record responses**

Three places need updating:
1. `src/server/services/records.ts` — the `#rowToCallRecord` private method (around line 610-625) maps DB rows to the `EncryptedCallRecord` type. Add `voicemailFileId: r.voicemailFileId` to its return object.
2. `src/server/types.ts` — verify `EncryptedCallRecord` interface includes `voicemailFileId`. If not, add `voicemailFileId?: string | null`.
3. `src/server/routes/calls.ts` — verify the `GET /calls/history` endpoint passes through the field. It should if `#rowToCallRecord` is updated.

- [ ] **Step 2: Add voicemailFileId to client CallRecord type**

In `src/client/lib/api.ts`, find the `CallRecord` interface and add:

```ts
voicemailFileId?: string | null
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/server/ src/client/lib/api.ts
git commit -m "feat: expose voicemailFileId in call history API response"
```

---

## Task 3: Client API Helpers for Voicemail Audio

**Files:**
- Modify: `src/client/lib/api.ts`

The existing files API endpoints (`GET /files/:id/content` and `GET /files/:id/envelopes` in `src/server/routes/files.ts`) already handle access control via `recipientEnvelopes` — if the user's pubkey is in the envelopes, they can download. Since Phase 2 encrypts voicemail audio for `voicemail:listen` recipients, the existing permission model works. **No new server endpoint needed.**

- [ ] **Step 1: Add getFileContent helper**

In `src/client/lib/api.ts`, add a helper to fetch file content as ArrayBuffer:

```ts
export async function getFileContent(fileId: string): Promise<ArrayBuffer> {
  const res = await fetch(`/api/files/${fileId}/content`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`)
  return res.arrayBuffer()
}
```

Check if a similar function already exists (maybe named differently). If so, reuse it.

- [ ] **Step 2: Verify getFileEnvelopes return type**

The existing `getFileEnvelopes` in api.ts likely returns `{ envelopes: FileKeyEnvelope[] }` (wrapped object, not bare array). Verify and note the correct access pattern: `result.envelopes` not `result` directly.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/api.ts
git commit -m "feat: add getFileContent client API helper for voicemail playback"
```

---

## Task 4: Voicemail Player Component

**Files:**
- Create: `src/client/components/voicemail-player.tsx`
- Modify: `src/client/routes/calls.tsx`

- [ ] **Step 1: Create VoicemailPlayer component**

The component fetches encrypted audio from the files API, decrypts client-side, and renders a player with transcript. Must handle two permission levels:
- `voicemail:listen` — full audio player + transcript
- `voicemail:read` — transcript only, no audio

Key implementation details:
- `decryptFile()` in `src/client/lib/file-crypto.ts` returns `{ blob: Blob; checksum: string }`, NOT a bare `Blob` — destructure correctly
- `getFileEnvelopes()` returns `{ envelopes: FileKeyEnvelope[] }` (wrapped object) — access via `.envelopes`
- Use the new `getFileContent()` from Task 3 for fetching audio bytes
- Fetch the voicemail transcript by querying notes for the callId and finding the one with `authorPubkey === 'system:voicemail'`

```tsx
interface Props {
  fileId?: string | null  // null if audio not stored (oversized or no blob)
  callId: string
  canListen: boolean  // voicemail:listen permission
}

export function VoicemailPlayer({ fileId, callId, canListen }: Props) {
  // State for audio + transcript
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Load transcript from notes API (system:voicemail author)
  useEffect(() => {
    // Fetch notes for this call, find authorPubkey === 'system:voicemail'
    // Decrypt using the user's key
    // setTranscript(decryptedText)
  }, [callId])

  // Load + decrypt audio only if canListen && fileId exists
  useEffect(() => {
    if (!canListen || !fileId) return
    // Fetch encrypted content + envelopes
    // const content = await getFileContent(fileId)
    // const { envelopes } = await getFileEnvelopes(fileId)
    // Find user's envelope, decrypt:
    // const { blob } = await decryptFile(new Uint8Array(content), envelope, secretKey)
    // setAudioUrl(URL.createObjectURL(blob))
  }, [fileId, canListen])

  // Render: audio player (if canListen) + transcript (always if available)
}
```

Follow the existing `RecordingPlayer` component patterns for key manager access, loading states, and audio element rendering.

- [ ] **Step 2: Wire VoicemailPlayer into calls.tsx with permission-gated rendering**

In `src/client/routes/calls.tsx`, replace the voicemail badge Link-to-notes. Check the user's permissions from the auth context:

```tsx
{call.hasVoicemail && (
  <VoicemailPlayer
    fileId={call.voicemailFileId}
    callId={call.id}
    canListen={checkPermission(permissions, 'voicemail:listen')}
  />
)}
```

If the user has `voicemail:read` but not `voicemail:listen`, they see the transcript but no audio player. If they have neither, the component doesn't render.

- [ ] **Step 3: Add voicemail filter to call history**

Add a filter option to the call history page to show only voicemails. Follow the pattern of existing filters (search, date range, etc.).

- [ ] **Step 4: Run typecheck and build**

Run: `bun run typecheck && bun run build`

- [ ] **Step 5: Commit**

```bash
git add src/client/
git commit -m "feat: add VoicemailPlayer component with client-side decryption"
```

---

## Task 5: Provider Voicemail Disablement Guide

**Files:**
- Create: `docs/operations/disable-provider-voicemail.md`

- [ ] **Step 1: Write the guide**

```markdown
# Disabling Provider-Native Voicemail

Llamenos handles voicemail internally — recording, encryption, storage, and playback
are all managed by the application. Third-party provider voicemail must be disabled
to prevent duplicate recordings and ensure caller audio stays encrypted.

## Twilio

1. Log into the Twilio Console
2. Navigate to Phone Numbers → Manage → Active Numbers
3. Select your hotline number
4. Under "Voice & Fax", ensure "Configure With" is set to "Webhooks"
5. Verify no Studio Flows intercept unanswered calls
6. Twilio does not have built-in voicemail — as long as your webhook is configured,
   Llamenos handles the full call flow including voicemail

## SignalWire

Same as Twilio — SignalWire is API-compatible. Ensure the number's webhook
points to your Llamenos instance. No native voicemail to disable.

## Plivo

1. Log into the Plivo Console
2. Navigate to Phone Numbers → Your Numbers
3. Select your hotline number
4. Ensure the "Voice URL" points to your Llamenos webhook
5. Disable any carrier-level voicemail on the underlying number
   (contact Plivo support if your carrier enables voicemail by default)

## Vonage

1. Log into the Vonage API Dashboard
2. Navigate to Numbers → Your Numbers
3. Select your hotline number
4. Under "Voice", ensure the webhook URL points to Llamenos
5. Vonage does not have built-in voicemail — recordings auto-expire after 30 days
6. Llamenos downloads and encrypts recordings immediately, then deletes via Media API

## Asterisk / Self-Hosted SIP

Asterisk voicemail is controlled by the dialplan. The Llamenos sip-bridge
manages the dialplan dynamically — no `Voicemail()` application is configured.
If you have custom dialplan extensions, ensure they do not route to `VoicemailMain`
or `Voicemail`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/operations/disable-provider-voicemail.md
git commit -m "docs: add provider voicemail disablement guide"
```

---

## Task 6: Tests

**Files:**
- Modify or create: `tests/api/voicemail-notifications.spec.ts`

- [ ] **Step 1: Test voicemail notification dispatch**

After the voicemail-recording webhook fires, verify:
- Nostr event published with `KIND_CALL_VOICEMAIL` (check via relay subscription or mock)
- Push notification sent to `voicemail:notify` users

Since Nostr and push are fire-and-forget, these may be hard to assert directly. At minimum, verify the webhook handler completes without error and the call record is updated.

- [ ] **Step 2: Test voicemailFileId in call history API**

After a voicemail is stored, `GET /api/calls/history` should return the call record with `voicemailFileId` set.

- [ ] **Step 3: Run all tests**

Run: `bun run test:unit && bun run test:api`

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: add voicemail notification and playback API tests"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run typecheck**: `bun run typecheck`
- [ ] **Step 2: Run build**: `bun run build`
- [ ] **Step 3: Run unit tests**: `bun run test:unit`
- [ ] **Step 4: Run API tests**: `bun run test:api`
- [ ] **Step 5: Check the app renders** — start dev server (`bun run dev:server` + `bun run dev`), navigate to call history, verify voicemail badge renders
- [ ] **Step 6: Commit any fixes**
