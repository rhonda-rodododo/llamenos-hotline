# Voicemail Phase 3: Notifications + Playback UI + Asterisk — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time voicemail notifications (Nostr relay + Web Push), voicemail audio playback with client-side decryption, expose `voicemailFileId` in the call history API, and write the provider voicemail disablement guide.

**Architecture:** When voicemail audio is encrypted and stored (end of Phase 1 flow in `/voicemail-recording` handler), the server publishes a `KIND_CALL_VOICEMAIL` (1002) Nostr event encrypted with the hub key, and sends Web Push notifications to users with `voicemail:notify` permission. The client plays back voicemail audio by fetching the encrypted blob from the files API, decrypting with the user's private key, and rendering an audio player. The Asterisk bridge recording endpoints are already functional via Phase 1's `getRecordingAudio` / `deleteRecording` adapter methods.

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
// Publish voicemail Nostr event (hub-key encrypted)
await publishNostrEvent(env, KIND_CALL_VOICEMAIL, {
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

- [ ] **Step 1: Check how call records are returned to the client**

Read `src/server/routes/calls.ts` — the `GET /calls/history` endpoint. Find where `callRecords` rows are mapped to the response shape. Ensure `voicemailFileId` is included in the response.

Also check `src/server/services/records.ts` — the `getCallHistory` or equivalent method. If it selects specific columns, add `voicemailFileId`.

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

## Task 3: Voicemail Playback API Endpoint

**Files:**
- Modify: `src/server/routes/calls.ts`

- [ ] **Step 1: Add GET /calls/:callId/voicemail endpoint**

This endpoint returns the encrypted voicemail audio blob + the requesting user's envelope. Requires `voicemail:listen` permission. Follow the pattern of the existing `GET /calls/:callId/recording` endpoint:

```ts
calls.get('/:callId/voicemail', requirePermission('voicemail:listen'), async (c) => {
  const callId = c.req.param('callId')
  const hubId = c.get('hubId')
  const services = c.get('services')

  // Get call record to find voicemailFileId
  const record = await services.records.getCallRecord(callId, hubId)
  if (!record?.voicemailFileId) {
    return c.json({ error: 'No voicemail found' }, 404)
  }

  const fileId = record.voicemailFileId

  // Get encrypted content from blob storage
  const blob = await services.files.getContent(fileId)
  if (!blob) {
    return c.json({ error: 'Voicemail file not found' }, 404)
  }

  // Get envelopes for the requesting user
  const fileRecord = await services.files.getFileRecord(fileId)
  if (!fileRecord) {
    return c.json({ error: 'File record not found' }, 404)
  }

  const userPubkey = c.get('pubkey')
  const envelope = fileRecord.recipientEnvelopes.find(e => e.pubkey === userPubkey)

  return c.json({
    encryptedContent: Buffer.from(blob).toString('hex'),
    envelope: envelope ?? null,
    fileId,
  })
})
```

Check what methods `FilesService` exposes for reading content and envelopes. The existing `GET /files/:id/content` and `GET /files/:id/envelopes` endpoints in `src/server/routes/files.ts` may already suffice — if so, the client can use those directly with the `voicemailFileId` instead of a dedicated voicemail endpoint. Decide which approach is cleaner.

Alternatively, the simpler approach: the client uses the existing files API (`GET /files/:id/content` + `GET /files/:id/envelopes`) directly, and no new voicemail-specific endpoint is needed. The `voicemail:listen` permission check would happen at the component level (the voicemail player only renders if the user has the permission).

- [ ] **Step 2: Decide on approach and implement**

If using existing files API: verify the permission check on `GET /files/:id/content` allows access for users whose pubkey is in the `recipientEnvelopes`. If the voicemail was encrypted for admin pubkeys only (Phase 1), only admins can access. Phase 2 should have switched to `voicemail:listen` recipients.

If creating a dedicated endpoint: implement it per the code above.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/calls.ts
git commit -m "feat: add voicemail playback API endpoint"
```

---

## Task 4: Voicemail Player Component

**Files:**
- Create: `src/client/components/voicemail-player.tsx`
- Modify: `src/client/routes/calls.tsx`

- [ ] **Step 1: Create VoicemailPlayer component**

The component fetches encrypted audio from the files API, decrypts client-side, and renders a player:

```tsx
import { useEffect, useState } from 'react'
import { getFileContent, getFileEnvelopes } from '@/lib/api'
import { decryptFile } from '@/lib/file-crypto'
import { useKeyManager } from '@/lib/key-manager'
import { Button } from '@/components/ui/button'
import { Pause, Play } from 'lucide-react'

interface Props {
  fileId: string
  callId: string
}

export function VoicemailPlayer({ fileId, callId }: Props) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyManager = useKeyManager()

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        // Fetch encrypted blob + envelopes
        const [content, envelopes] = await Promise.all([
          getFileContent(fileId),
          getFileEnvelopes(fileId),
        ])

        // Find user's envelope
        const myPubkey = keyManager.getPublicKey()
        const envelope = envelopes.find(e => e.pubkey === myPubkey)
        if (!envelope) {
          setError('No decryption key available')
          return
        }

        // Decrypt
        const secretKey = keyManager.getSecretKey()
        const blob = await decryptFile(new Uint8Array(content), envelope, secretKey)
        if (!cancelled) {
          setAudioUrl(URL.createObjectURL(blob))
        }
      } catch (err) {
        if (!cancelled) setError('Failed to load voicemail')
      }
    }
    load()
    return () => { cancelled = true }
  }, [fileId])

  // ... render audio element with play/pause controls
}
```

Adapt to match the existing `RecordingPlayer` component patterns — check how it accesses the key manager, handles loading states, and renders the audio element.

- [ ] **Step 2: Wire VoicemailPlayer into calls.tsx**

In `src/client/routes/calls.tsx`, replace the voicemail badge Link-to-notes with the VoicemailPlayer:

```tsx
{call.hasVoicemail && call.voicemailFileId && (
  <VoicemailPlayer fileId={call.voicemailFileId} callId={call.id} />
)}
{call.hasVoicemail && !call.voicemailFileId && (
  // Fallback: link to notes (transcript only, no audio)
  <Link to="/notes" search={{ callId: call.id }}>
    <Badge variant="secondary"><Voicemail className="h-3 w-3" /></Badge>
  </Link>
)}
```

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

Asterisk voicemail is controlled by the dialplan. The Llamenos asterisk-bridge
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

## Task 6: Final Verification

- [ ] **Step 1: Run typecheck**: `bun run typecheck`
- [ ] **Step 2: Run build**: `bun run build`
- [ ] **Step 3: Run unit tests**: `bun run test:unit`
- [ ] **Step 4: Run API tests**: `bun run test:api`
- [ ] **Step 5: Check the app renders** — start dev server (`bun run dev:server` + `bun run dev`), navigate to call history, verify voicemail badge renders
- [ ] **Step 6: Commit any fixes**
