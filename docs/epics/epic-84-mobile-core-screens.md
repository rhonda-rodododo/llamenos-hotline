# Epic 84: Mobile Core Screens — Dashboard, Calls, Notes, Shifts

## Problem Statement

With the mobile foundation in place (Epic 83), the app needs its core volunteer experience: a dashboard showing shift status and active calls, a call history view, encrypted note viewing/creation, and shift management. These are the screens volunteers interact with daily.

The primary technical challenge is porting the web app's Nostr relay integration (~600 LOC across 5 files) to React Native, where `window.location` doesn't exist and network state must be managed through `@react-native-community/netinfo` instead of `navigator.onLine`.

## Current State

### Web App Nostr Architecture (to port)

**5 files, ~600 LOC total:**

| File | LOC | Purpose | RN Portability |
|------|-----|---------|----------------|
| `src/client/lib/nostr/relay.ts` | 342 | `RelayManager` class — WebSocket, NIP-42 auth, subscriptions, reconnect | **Direct port** — WebSocket is native in RN, `crypto.randomUUID()` available in Hermes |
| `src/client/lib/nostr/events.ts` | 107 | `EventDeduplicator`, `createHubEvent()`, `validateLlamenosEvent()`, `parseLlamenosContent()` | **Direct port** — pure logic, no DOM deps |
| `src/client/lib/nostr/types.ts` | 101 | 12 event type interfaces, `RelayState`, `NostrEventHandler` | **Copy as-is** — pure TypeScript types |
| `src/client/lib/nostr/context.tsx` | 110 | `NostrProvider`, `useRelay()`, `useRelayState()` | **Rewrite** — remove `window.location` URL construction, use config URL directly |
| `src/client/lib/nostr/hooks.ts` | 45 | `useNostrSubscription()` hook | **Direct port** — pure React hooks |

**Also needed:**
- `src/client/lib/hub-key-manager.ts` (125 LOC) — `encryptForHub()` / `decryptFromHub()` using XChaCha20-Poly1305
- `src/shared/nostr-events.ts` (48 LOC) — Event kind constants (1000-1030, 20000-20001)
- `src/shared/crypto-labels.ts` — Domain separation constants for hub key wrap

### RelayManager Architecture (relay.ts — 342 LOC)

```typescript
// Constructor takes:
interface RelayManagerOptions {
  relayUrl: string          // Full WSS URL
  serverPubkey: string      // Server's Nostr pubkey for verifying authoritative events
  getSecretKey: () => Uint8Array | null  // From key manager
  getHubKey: () => Uint8Array | null     // Hub symmetric key
  onStateChange?: (state: RelayState) => void
}

// Key behaviors:
// - WebSocket connection with 10s timeout
// - NIP-42 auth: relay sends AUTH challenge → client signs kind 22242 event
// - If no AUTH challenge within 2s, assumes open relay
// - Subscriptions: REQ with kinds + #d (hubId) + #t (llamenos:event) filter
// - Event handling: verify signature → validate llamenos tags → deduplicate → decrypt with hub key → route to subscribers
// - Reconnect: exponential backoff (1s base, 30s max, 20 attempts) with random jitter
// - Graceful close: sends CLOSE for all subs, clears state
```

### Event Deduplication (events.ts)

Time-bucketed deduplicator (1-minute buckets, 5-minute TTL). Events older than 5 minutes are rejected. Memory-bounded — prunes old buckets every 60s. Uses `setInterval` which works in RN.

### Event Types (types.ts — 12 event variants)

```typescript
// Call events
'call:ring'        — CallRingEvent { callId, callerLast4?, startedAt }
'call:answered'    — CallAnsweredEvent { callId, volunteerPubkey }
'call:ended'       — CallEndedEvent { callId }
'call:update'      — CallUpdateEvent { callId, status, answeredBy? }

// Voicemail
'voicemail:new'    — VoicemailEvent { callId, startedAt }

// Presence
'presence:summary' — PresenceSummaryEvent { hasAvailable }
'presence:detail'  — PresenceDetailEvent { available, onCall, total }

// Messaging
'message:new'      — MessageNewEvent { conversationId, channelType }
'conversation:assigned' — ConversationAssignedEvent { conversationId, assignedTo }
'conversation:closed'   — ConversationClosedEvent { conversationId }
'conversation:new'      — ConversationNewEvent { conversationId }
'message:status'        — MessageStatusEvent { conversationId, messageId, status }
```

### Nostr Event Kinds (nostr-events.ts)

```typescript
// Regular (persisted): 1000-1030
KIND_CALL_RING = 1000
KIND_CALL_UPDATE = 1001
KIND_CALL_VOICEMAIL = 1002
KIND_MESSAGE_NEW = 1010
KIND_CONVERSATION_ASSIGNED = 1011
KIND_SHIFT_UPDATE = 1020
KIND_SETTINGS_CHANGED = 1030

// Ephemeral (broadcast only): 20000-20001
KIND_PRESENCE_UPDATE = 20000
KIND_CALL_SIGNAL = 20001

// NIP-42 Auth: 22242
KIND_NIP42_AUTH = 22242
```

### Hub Key Encryption (hub-key-manager.ts)

Hub key is a random 32-byte symmetric key, ECIES-wrapped per member. Used for relay event content encryption:

```typescript
// Encrypt: XChaCha20-Poly1305 with random 24-byte nonce
// Output: hex(nonce || ciphertext)
encryptForHub(plaintext: string, hubKey: Uint8Array): string

// Decrypt: split nonce (24 bytes) + ciphertext, decrypt
decryptFromHub(packed: string, hubKey: Uint8Array): string | null
```

On mobile, `@noble/ciphers` works with Hermes BigInt support (Expo SDK 55). The ECIES unwrap for hub key distribution uses `@noble/curves/secp256k1`.

### Context Provider Changes for React Native

The web app's `NostrProvider` (`context.tsx:66-72`) constructs the WebSocket URL from `window.location`:

```typescript
// WEB — uses window.location (NOT available in RN)
if (relayUrl.startsWith('ws://') || relayUrl.startsWith('wss://')) {
  wsUrl = relayUrl
} else {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  wsUrl = `${protocol}//${window.location.host}${relayUrl}`
}
```

**Mobile fix**: The API config endpoint returns the relay URL. On mobile, always use absolute WSS URLs from the config — never construct from `window.location`. The mobile `NostrProvider` should require a full `wss://` URL and throw if given a relative path.

### Network State Integration

Web app uses `navigator.onLine` implicitly (WebSocket fails when offline). On React Native:

```typescript
import NetInfo from '@react-native-community/netinfo'

// React Query already needs this (Epic 83), so NetInfo is a dep
// Add network-aware reconnect to RelayManager:
NetInfo.addEventListener(state => {
  if (state.isConnected && relay.getState() === 'disconnected') {
    relay.connect()
  }
})
```

## Requirements

### Functional Requirements

1. **Dashboard** — Shift status indicator, active call count, today's stats, volunteer presence
2. **Call handling** — Incoming call notification via Nostr relay, answer/decline, call notes during active call
3. **Notes** — List view with client-side decryption, note detail view, search/filter
4. **Shifts** — Weekly schedule view, sign-up/drop for available shifts
5. **Nostr relay** — Real-time event subscription for call notifications and presence

### Non-Functional Requirements

- Note decryption happens client-side (E2EE)
- Real-time updates via Nostr relay (< 1s latency)
- Offline indicator when relay disconnects
- Network state changes trigger relay reconnect

## Technical Design

### Tab Navigator

```
app/(tabs)/
  _layout.tsx     — Tab bar (Dashboard, Notes, Shifts, Profile)
  index.tsx       — Dashboard
  notes.tsx       — Notes list
  shifts.tsx      — Shift schedule
  profile.tsx     — User settings
```

### Dashboard (`app/(tabs)/index.tsx`)

- Current shift status (on-shift / off-shift / break) — from API
- Active calls count — from `KIND_CALL_RING` / `KIND_CALL_UPDATE` events via Nostr
- Today's stats (calls answered, notes created) — from API
- Presence indicator — from `KIND_PRESENCE_UPDATE` events
- Quick actions (go on shift, go on break)

Subscribes to event kinds: `[1000, 1001, 20000]` (call ring, call update, presence)

### Call Flow

- `app/call/[id].tsx` — Active call screen
- Incoming call: `CallRingEvent` received via Nostr → show overlay card or local notification
- Answer → POST `/api/calls/:id/answer` → Twilio Voice connection established
- Notes editor during call (auto-encrypted, auto-saved via `encryptNote()`)
- Hangup → POST `/api/calls/:id/hangup` → save final note

**Note**: On mobile, actual voice is carried by the phone network (Twilio parallel ringing calls the volunteer's phone). The app handles coordination (answer intent, notes, hangup) but not audio.

### Notes

- `app/(tabs)/notes.tsx` — Paginated list with React Query infinite scroll
- `app/note/[id].tsx` — Full note detail (decrypted via `decryptNote()`)
- `src/components/NoteCard.tsx` — Note preview card (decrypts first 100 chars)
- `src/components/EncryptedContent.tsx` — Decryption wrapper (shows spinner while decrypting, error state on failure)
- Search by date range, tags — API-side filtering, client-side decryption of results

### Shifts

- `app/(tabs)/shifts.tsx` — Weekly calendar + list toggle
- `src/components/ShiftCalendar.tsx` — Visual weekly schedule (7-day horizontal scroll)
- Sign up for open shifts via POST `/api/shifts/:id/signup`
- Drop shifts (with confirmation dialog) via DELETE `/api/shifts/:id/signup`
- Real-time shift updates via `KIND_SHIFT_UPDATE` (kind 1020) events

### Nostr Relay Port — File-by-File Guide

#### 1. `src/lib/nostr/types.ts` — Copy as-is
All 12 event type interfaces, `RelayState`, `NostrEventHandler`. Pure TypeScript, zero DOM deps.

#### 2. `src/lib/nostr/events.ts` — Direct port
- `EventDeduplicator` — uses `Map`, `Set`, `setInterval`, `Date.now()` — all available in Hermes
- `createHubEvent()` — uses `nostr-tools/pure` `finalizeEvent()` — works with polyfill
- `validateLlamenosEvent()` — uses `nostr-tools/pure` `verifyEvent()` — works with polyfill
- `parseLlamenosContent()` — pure JSON parse

**Change**: Import `react-native-get-random-values` BEFORE `nostr-tools` (Epic 83 handles this globally).

#### 3. `src/lib/nostr/relay.ts` — Direct port with minor changes
- `WebSocket` — native in React Native, same API as browser
- `crypto.randomUUID()` — available in Hermes (Expo SDK 55)
- `JSON.parse()` / `JSON.stringify()` — standard
- `setTimeout` / `clearTimeout` — standard in RN
- `Math.random()` / `Math.pow()` / `Math.min()` — standard

**Changes needed**:
1. Replace `typeof msg.data === 'string' ? msg.data : ''` — in RN, WebSocket message `data` is always a string for text frames. This works as-is.
2. No changes to subscription logic — `REQ`/`CLOSE` messages are standard Nostr protocol.

#### 4. `src/lib/nostr/context.tsx` — Rewrite for React Native

```typescript
// MOBILE — no window.location, require absolute URL
export function NostrProvider({ children, relayUrl, serverPubkey, isAuthenticated, getSecretKey, getHubKey }: NostrProviderProps) {
  const [state, setState] = useState<RelayState>('disconnected')
  const relayRef = useRef<RelayManager | null>(null)
  const netInfoRef = useRef<ReturnType<typeof NetInfo.addEventListener> | null>(null)

  useEffect(() => {
    if (!isAuthenticated || !relayUrl || !serverPubkey) {
      relayRef.current?.close()
      relayRef.current = null
      setState('disconnected')
      return
    }

    // Mobile requires absolute WSS URL from config
    if (!relayUrl.startsWith('wss://') && !relayUrl.startsWith('ws://')) {
      console.error('[nostr] Mobile requires absolute WebSocket URL')
      return
    }

    const manager = new RelayManager({
      relayUrl,
      serverPubkey,
      getSecretKey: () => getSecretKeyRef.current(),
      getHubKey: () => getHubKeyRef.current(),
      onStateChange: setState,
    })

    relayRef.current = manager
    manager.connect().catch(() => {})

    // Network-aware reconnect
    const unsub = NetInfo.addEventListener(netState => {
      if (netState.isConnected && manager.getState() === 'disconnected') {
        manager.connect().catch(() => {})
      }
    })
    netInfoRef.current = unsub

    return () => {
      unsub()
      manager.close()
      relayRef.current = null
      setState('disconnected')
    }
  }, [isAuthenticated, relayUrl, serverPubkey])

  return (
    <NostrContext.Provider value={{ relay: relayRef.current, state }}>
      {children}
    </NostrContext.Provider>
  )
}
```

#### 5. `src/lib/nostr/hooks.ts` — Direct port
`useNostrSubscription()` — pure React hooks, no DOM deps. Uses `useRef`, `useEffect`, `useContext`. Works identically in React Native.

#### 6. `src/lib/hub-key-manager.ts` — Port with crypto adapter

Hub key encrypt/decrypt uses `@noble/ciphers/chacha.js` (`xchacha20poly1305`) and `@noble/hashes/utils.js` (`bytesToHex`, `hexToBytes`). Both work in Hermes with BigInt support.

**Changes needed**:
1. Replace `crypto.getRandomValues(buf)` with polyfilled version (Epic 83's global `react-native-get-random-values` import handles this)
2. Import paths: `@noble/ciphers/chacha.js` and `@noble/hashes/utils.js` — same `.js` extension required

#### 7. `src/shared/nostr-events.ts` — Copy as-is
Pure constants, zero dependencies.

#### 8. `src/shared/crypto-labels.ts` — Copy as-is
25 string constants, zero dependencies.

### Dependencies to Install

```bash
# Already from Epic 83:
# nostr-tools, @noble/curves, @noble/ciphers, @noble/hashes, react-native-get-random-values

# New for Epic 84:
npx expo install @react-native-community/netinfo
```

## Files to Create

### Screens
- `app/(tabs)/_layout.tsx` — Tab navigator
- `app/(tabs)/index.tsx` — Dashboard
- `app/(tabs)/notes.tsx` — Notes list
- `app/(tabs)/shifts.tsx` — Shift schedule
- `app/(tabs)/profile.tsx` — User settings
- `app/call/[id].tsx` — Active call screen
- `app/note/[id].tsx` — Note detail

### Components
- `src/components/CallCard.tsx` — Call status card
- `src/components/ShiftStatus.tsx` — Shift indicator
- `src/components/NoteCard.tsx` — Note preview with decryption
- `src/components/EncryptedContent.tsx` — Decryption wrapper
- `src/components/ShiftCalendar.tsx` — Weekly calendar

### Nostr Relay (ported from web)
- `src/lib/nostr/types.ts` — Event types (copy)
- `src/lib/nostr/events.ts` — Deduplicator + validation (port)
- `src/lib/nostr/relay.ts` — RelayManager (port)
- `src/lib/nostr/context.tsx` — NostrProvider (rewrite for RN)
- `src/lib/nostr/hooks.ts` — useNostrSubscription (port)

### Shared Code (ported from web)
- `src/lib/hub-key-manager.ts` — Hub key encrypt/decrypt (port)
- `src/shared/nostr-events.ts` — Event kind constants (copy)
- `src/shared/crypto-labels.ts` — Domain separation constants (copy)

## Acceptance Criteria

- [ ] Tab navigation works (Dashboard, Notes, Shifts, Profile)
- [ ] Dashboard shows shift status and call stats
- [ ] Dashboard receives real-time presence updates via Nostr relay
- [ ] Incoming call notifications appear via `call:ring` events
- [ ] Notes list decrypts and displays note previews
- [ ] Note detail view shows full decrypted content
- [ ] Shift schedule displays weekly view
- [ ] Can sign up for / drop shifts
- [ ] Nostr relay connects and receives real-time events
- [ ] NIP-42 authentication works (relay challenge → signed kind 22242 response)
- [ ] Hub key decryption works for event payloads
- [ ] Network-aware reconnect (NetInfo triggers reconnect when connection restored)
- [ ] Offline indicator shows when relay disconnects

## Dependencies

- **Epic 83** (Mobile Foundation) — auth flow, crypto, API client, nostr-tools must be working
- **Epic 76** (Nostr Relay Sync) — relay infrastructure for real-time events (complete)
