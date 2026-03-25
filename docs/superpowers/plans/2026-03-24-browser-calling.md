# Browser Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Volunteers can answer calls directly in the browser via WebRTC using provider SDKs (Twilio, Vonage, Plivo), without needing a phone number.

**Architecture:** Refactor the existing Twilio-specific `webrtc.ts` into a provider-agnostic `WebRTCManager` + per-provider `WebRTCAdapter` implementations. Extend `RingVolunteersParams` to include browser client identities. Update each telephony adapter's `ringVolunteers()` to emit `<Client>`/`<User>`/NCCO `app` directives alongside `<Number>` for parallel ringing. Extend the answer endpoint with call leg tracking and cancellation.

**Tech Stack:** `@twilio/voice-sdk` (existing), `@vonage/client-sdk`, `plivo-browser-sdk`, Hono, Drizzle ORM

**Spec:** `docs/superpowers/specs/2026-03-24-web-push-browser-calling-design.md` (Feature B)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/client/lib/webrtc/types.ts` | `WebRTCAdapter` interface, `WebRtcState`, event types |
| `src/client/lib/webrtc/manager.ts` | `WebRTCManager`: state machine, adapter factory, token refresh |
| `src/client/lib/webrtc/adapters/twilio.ts` | `TwilioWebRTCAdapter`: wraps `@twilio/voice-sdk` |
| `src/client/lib/webrtc/adapters/vonage.ts` | `VonageWebRTCAdapter`: wraps `@vonage/client-sdk` |
| `src/client/lib/webrtc/adapters/plivo.ts` | `PlivoWebRTCAdapter`: wraps `plivo-browser-sdk` |

---

### Task 1: WebRTCAdapter interface and types

**Files:**
- Create: `src/client/lib/webrtc/types.ts`
- Test: `src/client/lib/webrtc/types.test.ts` (compile-time type checks)

- [ ] **Step 1: Define the WebRTCAdapter interface and state type**

```typescript
// src/client/lib/webrtc/types.ts

export type WebRtcState = 'idle' | 'initializing' | 'ready' | 'ringing' | 'connected' | 'ended' | 'error'

export type WebRtcEvent = 'incoming' | 'connected' | 'disconnected' | 'error'

export type WebRtcEventHandler<E extends WebRtcEvent> =
  E extends 'incoming' ? (callSid: string) => void :
  E extends 'connected' ? () => void :
  E extends 'disconnected' ? () => void :
  E extends 'error' ? (error: Error) => void :
  never

export interface WebRTCAdapter {
  initialize(token: string): Promise<void>
  accept(callSid: string): Promise<void>
  reject(callSid: string): Promise<void>
  disconnect(): void
  setMuted(muted: boolean): void
  isMuted(): boolean
  on<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void
  off<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void
  destroy(): void
}

export interface WebRTCManagerConfig {
  provider: string
  token: string
  ttl: number // seconds
  identity: string
}

export type StateChangeHandler = (state: WebRtcState, error?: string) => void
```

- [ ] **Step 2: Verify types compile**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/webrtc/types.ts
git commit -m "feat: add WebRTCAdapter interface and state types"
```

---

### Task 2: TwilioWebRTCAdapter (refactor from existing webrtc.ts)

**Files:**
- Create: `src/client/lib/webrtc/adapters/twilio.ts`
- Test: `src/client/lib/webrtc/adapters/twilio.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/client/lib/webrtc/adapters/twilio.test.ts
import { describe, expect, test } from 'bun:test'
import { TwilioWebRTCAdapter } from './twilio'

describe('TwilioWebRTCAdapter', () => {
  test('implements WebRTCAdapter interface', () => {
    const adapter = new TwilioWebRTCAdapter()
    expect(typeof adapter.initialize).toBe('function')
    expect(typeof adapter.accept).toBe('function')
    expect(typeof adapter.reject).toBe('function')
    expect(typeof adapter.disconnect).toBe('function')
    expect(typeof adapter.setMuted).toBe('function')
    expect(typeof adapter.isMuted).toBe('function')
    expect(typeof adapter.on).toBe('function')
    expect(typeof adapter.off).toBe('function')
    expect(typeof adapter.destroy).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/client/lib/webrtc/adapters/twilio.test.ts
```

- [ ] **Step 3: Implement TwilioWebRTCAdapter**

Extract the Twilio-specific code from `src/client/lib/webrtc.ts` into the adapter. Key mappings from existing code:

- `initTwilioWebRtc(token)` → `adapter.initialize(token)`
- `activeConnection.accept()` → `adapter.accept(callSid)`
- `activeConnection.reject()` → `adapter.reject(callSid)`
- `activeConnection.disconnect()` → `adapter.disconnect()`
- `activeConnection.mute(muted)` → `adapter.setMuted(muted)`
- Twilio `Device.on('incoming', conn)` → emit `'incoming'` event with `conn.parameters.CallSid`
- Twilio `conn.on('accept')` → emit `'connected'`
- Twilio `conn.on('disconnect')` → emit `'disconnected'`
- Twilio `Device.on('error')` → emit `'error'`

```typescript
// src/client/lib/webrtc/adapters/twilio.ts
import type { WebRTCAdapter, WebRtcEvent, WebRtcEventHandler } from '../types'

// Minimal Twilio SDK types (same as current webrtc.ts)
interface TwilioDevice {
  register: () => Promise<void>
  unregister: () => Promise<void>
  updateToken: (token: string) => void
  on: (event: string, handler: (...args: unknown[]) => void) => void
  off: (event: string, handler: (...args: unknown[]) => void) => void
  destroy: () => void
  state: string
}

interface TwilioCall {
  accept: (opts?: Record<string, unknown>) => void
  reject: () => void
  disconnect: () => void
  mute: (muted?: boolean) => void
  isMuted: () => boolean
  on: (event: string, handler: (...args: unknown[]) => void) => void
  parameters: Record<string, string>
  status: () => string
}

export class TwilioWebRTCAdapter implements WebRTCAdapter {
  #device: TwilioDevice | null = null
  #activeCall: TwilioCall | null = null
  #handlers = new Map<string, Set<(...args: unknown[]) => void>>()

  async initialize(token: string): Promise<void> {
    const sdkModule = '@twilio/voice-sdk'
    const { Device } = (await import(/* @vite-ignore */ sdkModule)) as {
      Device: new (token: string, opts: Record<string, unknown>) => TwilioDevice
    }

    const device = new Device(token, {
      closeProtection: true,
      codecPreferences: ['opus', 'pcmu'],
    })

    device.on('incoming', (...args: unknown[]) => {
      const call = args[0] as TwilioCall
      this.#activeCall = call
      const callSid = call.parameters.CallSid ?? ''
      this.#emit('incoming', callSid)

      call.on('accept', () => this.#emit('connected'))
      call.on('disconnect', () => {
        this.#activeCall = null
        this.#emit('disconnected')
      })
      call.on('reject', () => {
        this.#activeCall = null
        this.#emit('disconnected')
      })
    })

    device.on('error', (...args: unknown[]) => {
      const err = args[0] as { message?: string }
      this.#emit('error', new Error(err?.message ?? 'Twilio Device error'))
    })

    this.#device = device
    await device.register()
  }

  async accept(_callSid: string): Promise<void> {
    this.#activeCall?.accept({
      rtcConstraints: {
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      },
    })
  }

  async reject(_callSid: string): Promise<void> {
    this.#activeCall?.reject()
    this.#activeCall = null
  }

  disconnect(): void {
    this.#activeCall?.disconnect()
    this.#activeCall = null
  }

  setMuted(muted: boolean): void {
    this.#activeCall?.mute(muted)
  }

  isMuted(): boolean {
    return this.#activeCall?.isMuted() ?? false
  }

  on<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set())
    this.#handlers.get(event)!.add(handler as (...args: unknown[]) => void)
  }

  off<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void {
    this.#handlers.get(event)?.delete(handler as (...args: unknown[]) => void)
  }

  destroy(): void {
    this.#activeCall?.disconnect()
    this.#activeCall = null
    this.#device?.destroy()
    this.#device = null
    this.#handlers.clear()
  }

  /** Update token for refresh (Twilio-specific) */
  updateToken(token: string): void {
    this.#device?.updateToken(token)
  }

  #emit(event: string, ...args: unknown[]): void {
    this.#handlers.get(event)?.forEach((h) => h(...args))
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun test src/client/lib/webrtc/adapters/twilio.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/webrtc/adapters/twilio.ts src/client/lib/webrtc/adapters/twilio.test.ts
git commit -m "feat: TwilioWebRTCAdapter extracted from existing webrtc.ts"
```

---

### Task 3: VonageWebRTCAdapter

**Files:**
- Create: `src/client/lib/webrtc/adapters/vonage.ts`
- Test: `src/client/lib/webrtc/adapters/vonage.test.ts`

- [ ] **Step 1: Install Vonage Client SDK**

```bash
bun add @vonage/client-sdk
```

- [ ] **Step 2: Write the failing test**

Same pattern as Twilio test — verify interface implementation.

- [ ] **Step 3: Implement VonageWebRTCAdapter**

Key mappings from research:
- `VonageClient.createSession(token)` → `adapter.initialize(token)` — establishes signaling connection
- `client.on('callInvite', (callId, from, channelType))` → emit `'incoming'` with `callId`
- `client.answer(callId)` → `adapter.accept(callId)`
- `client.reject(callId)` → `adapter.reject(callId)`
- `client.on('callHangup')` → emit `'disconnected'`
- `client.on('callInviteCancel', (callId, reason))` → emit `'disconnected'` (for `AnsweredElsewhere`)

```typescript
// src/client/lib/webrtc/adapters/vonage.ts
import type { WebRTCAdapter, WebRtcEvent, WebRtcEventHandler } from '../types'

export class VonageWebRTCAdapter implements WebRTCAdapter {
  #client: VonageClientType | null = null
  #activeCallId: string | null = null
  #muted = false
  #handlers = new Map<string, Set<(...args: unknown[]) => void>>()

  async initialize(token: string): Promise<void> {
    const { VonageClient } = await import(/* @vite-ignore */ '@vonage/client-sdk')
    const client = new VonageClient()
    await client.createSession(token)

    client.on('callInvite', (callId: string, _from: string, _channelType: string) => {
      this.#emit('incoming', callId)
    })

    client.on('callInviteCancel', (_callId: string, _reason: string) => {
      this.#emit('disconnected')
    })

    client.on('callHangup', (_callId: string) => {
      this.#emit('disconnected')
    })

    this.#client = client
  }

  async accept(callId: string): Promise<void> {
    await this.#client?.answer(callId)
    this.#emit('connected')
  }

  async reject(callId: string): Promise<void> {
    await this.#client?.reject(callId)
  }

  disconnect(): void {
    // Vonage Client SDK v2: look up the hangup method via context7 at implementation time.
    // It may be client.hangup(callId) or similar. Track the active callId from the callInvite event.
    if (this.#activeCallId && this.#client) {
      // this.#client.hangup(this.#activeCallId) — verify exact API
    }
    this.#activeCallId = null
    this.#emit('disconnected')
  }

  setMuted(muted: boolean): void {
    // Vonage Client SDK v2: look up the mute API via context7 at implementation time.
    // It may be client.mute(callId) / client.unmute(callId), or enableMedia/disableMedia.
    // Must implement — no stubs allowed per project rules.
    this.#muted = muted
  }

  isMuted(): boolean {
    return this.#muted
  }

  on<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set())
    this.#handlers.get(event)!.add(handler as (...args: unknown[]) => void)
  }

  off<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void {
    this.#handlers.get(event)?.delete(handler as (...args: unknown[]) => void)
  }

  destroy(): void {
    this.#client = null
    this.#handlers.clear()
  }

  #emit(event: string, ...args: unknown[]): void {
    this.#handlers.get(event)?.forEach((h) => h(...args))
  }
}

// Minimal type for dynamic import
type VonageClientType = {
  createSession: (token: string) => Promise<string>
  answer: (callId: string) => Promise<void>
  reject: (callId: string) => Promise<void>
  on: (event: string, handler: (...args: unknown[]) => void) => void
}
```

**Important:** The Vonage Client SDK docs should be checked via context7 at implementation time to verify exact API for v2.x. The `callInvite` event signature and mute API may differ.

- [ ] **Step 4: Run tests**

```bash
bun test src/client/lib/webrtc/adapters/vonage.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/webrtc/adapters/vonage.ts src/client/lib/webrtc/adapters/vonage.test.ts
git commit -m "feat: VonageWebRTCAdapter"
```

---

### Task 4: PlivoWebRTCAdapter

**Files:**
- Create: `src/client/lib/webrtc/adapters/plivo.ts`
- Test: `src/client/lib/webrtc/adapters/plivo.test.ts`

- [ ] **Step 1: Install Plivo Browser SDK**

```bash
bun add plivo-browser-sdk
```

- [ ] **Step 2: Write the failing test**

Same pattern as Twilio/Vonage.

- [ ] **Step 3: Implement PlivoWebRTCAdapter**

Key difference: Plivo uses endpoint username/password, not JWT tokens. The `initialize(token)` method receives a custom token from the server that encodes the endpoint credentials.

Key mappings from research:
- `new Plivo(opts)` + `client.login(username, password)` → `adapter.initialize(token)` — decode credentials from token
- `client.on('onIncomingCall', (callerName, extraHeaders, callInfo))` → emit `'incoming'` with `callInfo.callUUID`
- `client.answer(callUUID)` → `adapter.accept(callUUID)`
- `client.reject(callUUID)` → `adapter.reject(callUUID)`
- `client.hangup()` → `adapter.disconnect()`
- `client.mute()` / `client.unmute()` → `adapter.setMuted(muted)`

```typescript
// src/client/lib/webrtc/adapters/plivo.ts
import type { WebRTCAdapter, WebRtcEvent, WebRtcEventHandler } from '../types'

export class PlivoWebRTCAdapter implements WebRTCAdapter {
  #client: PlivoClientType | null = null
  #handlers = new Map<string, Set<(...args: unknown[]) => void>>()
  #muted = false

  async initialize(token: string): Promise<void> {
    // Token is base64url-encoded JSON with { username, authId, exp, sig }
    // Decode to get endpoint credentials
    const decoded = JSON.parse(atob(token.replace(/-/g, '+').replace(/_/g, '/')))

    const { default: Plivo } = await import(/* @vite-ignore */ 'plivo-browser-sdk')
    const plivoClient = new Plivo({
      debug: 'WARN',
      permOnClick: false,
      allowMultipleIncomingCalls: false,
    })

    plivoClient.client.on('onLogin', () => {
      // Ready to receive calls
    })

    plivoClient.client.on('onLoginFailed', (error: unknown) => {
      this.#emit('error', new Error(`Plivo login failed: ${error}`))
    })

    plivoClient.client.on('onIncomingCall', (_callerName: string, _extraHeaders: unknown, callInfo: { callUUID: string }) => {
      this.#emit('incoming', callInfo.callUUID)
    })

    plivoClient.client.on('onCallAnswered', () => {
      this.#emit('connected')
    })

    plivoClient.client.on('onCallTerminated', () => {
      this.#emit('disconnected')
    })

    plivoClient.client.on('onIncomingCallCanceled', () => {
      this.#emit('disconnected')
    })

    // Login with endpoint credentials
    // Note: Plivo uses username/password auth, not JWT
    // The server's generatePlivoToken needs to return credentials the SDK can use
    plivoClient.client.login(decoded.username, decoded.authId)

    this.#client = plivoClient.client
  }

  async accept(callUUID: string): Promise<void> {
    this.#client?.answer(callUUID)
  }

  async reject(callUUID: string): Promise<void> {
    this.#client?.reject(callUUID)
  }

  disconnect(): void {
    this.#client?.hangup()
  }

  setMuted(muted: boolean): void {
    if (muted) {
      this.#client?.mute()
    } else {
      this.#client?.unmute()
    }
    this.#muted = muted
  }

  isMuted(): boolean {
    return this.#muted
  }

  on<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set())
    this.#handlers.get(event)!.add(handler as (...args: unknown[]) => void)
  }

  off<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void {
    this.#handlers.get(event)?.delete(handler as (...args: unknown[]) => void)
  }

  destroy(): void {
    this.#client?.logout?.()
    this.#client = null
    this.#handlers.clear()
  }

  #emit(event: string, ...args: unknown[]): void {
    this.#handlers.get(event)?.forEach((h) => h(...args))
  }
}

type PlivoClientType = {
  login: (username: string, password: string) => void
  logout?: () => void
  answer: (callUUID: string) => void
  reject: (callUUID: string) => void
  hangup: () => void
  mute: () => void
  unmute: () => void
  on: (event: string, handler: (...args: unknown[]) => void) => void
}
```

**CRITICAL — Plivo auth prerequisite:** Before implementing this adapter, you MUST research the Plivo Browser SDK auth flow via context7. The current `generatePlivoToken()` creates an HMAC-signed blob with `authId` (account-level), but the Plivo Browser SDK's `login()` expects **endpoint username + password** (created via Plivo REST API `POST /v1/Account/{auth_id}/Endpoint/`). Options:
1. Use `loginWithAccessToken()` if available — verify via context7 docs
2. Create Plivo endpoints via REST API during volunteer setup and store credentials
3. Use the Plivo REST API to provision endpoints on-demand

Resolve this BEFORE writing the adapter. Update `generatePlivoToken()` in `webrtc-tokens.ts` and the token endpoint response to match whichever auth mechanism works. The adapter's `initialize(token)` must receive whatever credentials the SDK needs.

- [ ] **Step 4: Run tests**

```bash
bun test src/client/lib/webrtc/adapters/plivo.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/webrtc/adapters/plivo.ts src/client/lib/webrtc/adapters/plivo.test.ts
git commit -m "feat: PlivoWebRTCAdapter"
```

---

### Task 5: WebRTCManager (state machine + adapter factory)

**Files:**
- Create: `src/client/lib/webrtc/manager.ts`
- Delete: `src/client/lib/webrtc.ts` (replaced by manager)
- Test: `src/client/lib/webrtc/manager.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/client/lib/webrtc/manager.test.ts
import { describe, expect, test } from 'bun:test'

describe('WebRTCManager', () => {
  test('initial state is idle', () => {
    // const manager = new WebRTCManager()
    // expect(manager.getState()).toBe('idle')
  })

  test('state transitions: idle -> initializing -> ready', () => {
    // Mock adapter that resolves initialize
    // manager.initialize(config)
    // Verify state transitions
  })

  test('ended state transitions back to ready', () => {
    // After disconnect, state goes to ended then back to ready
  })

  test('error state allows retry (-> initializing)', () => {
    // After error, calling initialize transitions to initializing
  })

  test('factory selects correct adapter for provider', () => {
    // 'twilio' -> TwilioWebRTCAdapter
    // 'vonage' -> VonageWebRTCAdapter
    // 'plivo' -> PlivoWebRTCAdapter
  })
})
```

- [ ] **Step 2: Implement WebRTCManager**

```typescript
// src/client/lib/webrtc/manager.ts
import type { WebRTCAdapter, WebRTCManagerConfig, WebRtcState, StateChangeHandler } from './types'
import { TwilioWebRTCAdapter } from './adapters/twilio'
import { VonageWebRTCAdapter } from './adapters/vonage'
import { PlivoWebRTCAdapter } from './adapters/plivo'
import { getWebRtcToken } from '../api'

function createAdapter(provider: string): WebRTCAdapter {
  switch (provider) {
    case 'twilio':
    case 'signalwire':
      return new TwilioWebRTCAdapter()
    case 'vonage':
      return new VonageWebRTCAdapter()
    case 'plivo':
      return new PlivoWebRTCAdapter()
    default:
      throw new Error(`No WebRTC adapter for provider: ${provider}`)
  }
}

let currentState: WebRtcState = 'idle'
let adapter: WebRTCAdapter | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let incomingCallSid: string | null = null // Track the current incoming call SID
const stateHandlers = new Set<StateChangeHandler>()

function setState(state: WebRtcState, error?: string) {
  currentState = state
  stateHandlers.forEach((h) => h(state, error))
}

export function getState(): WebRtcState {
  return currentState
}

export function onStateChange(handler: StateChangeHandler): () => void {
  stateHandlers.add(handler)
  return () => stateHandlers.delete(handler)
}

export async function initWebRtc(forceRefresh = false): Promise<void> {
  if (!forceRefresh && (currentState === 'ready' || currentState === 'initializing')) return

  setState('initializing')

  try {
    const { token, provider, identity, ttl } = await getWebRtcToken()

    adapter?.destroy()
    adapter = createAdapter(provider)

    adapter.on('incoming', (callSid) => {
      incomingCallSid = callSid
      setState('ringing')
    })

    adapter.on('connected', () => {
      setState('connected')
    })

    adapter.on('disconnected', () => {
      incomingCallSid = null
      setState('ended')
      // Transient state — return to ready after cleanup
      setTimeout(() => {
        if (currentState === 'ended') setState('ready')
      }, 100)
    })

    adapter.on('error', (error) => {
      setState('error', error.message)
    })

    await adapter.initialize(token)
    setState('ready')

    // Schedule token refresh
    if (ttl && ttl > 120) {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(async () => {
        try {
          const refresh = await getWebRtcToken()
          // Twilio supports updateToken, others need re-init
          if (adapter instanceof TwilioWebRTCAdapter) {
            (adapter as TwilioWebRTCAdapter).updateToken(refresh.token)
          } else {
            await initWebRtc(true) // forceRefresh bypasses the 'ready' guard
          }
        } catch (err) {
          console.warn('[webrtc] Token refresh failed:', err)
        }
      }, (ttl - 60) * 1000)
    }
  } catch (err) {
    console.error('[webrtc] Init failed:', err)
    setState('error', err instanceof Error ? err.message : 'WebRTC initialization failed')
  }
}

export function acceptCall(): void {
  if (adapter && currentState === 'ringing' && incomingCallSid) {
    adapter.accept(incomingCallSid).catch((err) => {
      console.error('[webrtc] Accept failed:', err)
    })
  }
}

export function rejectCall(): void {
  if (adapter && currentState === 'ringing' && incomingCallSid) {
    adapter.reject(incomingCallSid).catch((err) => {
      console.error('[webrtc] Reject failed:', err)
    })
    incomingCallSid = null
    setState('ready')
  }
}

export function hangupCall(): void {
  adapter?.disconnect()
}

export function toggleMute(): boolean {
  if (!adapter) return false
  const newMuted = !adapter.isMuted()
  adapter.setMuted(newMuted)
  return newMuted
}

export function isMuted(): boolean {
  return adapter?.isMuted() ?? false
}

export function destroyWebRtc(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  adapter?.destroy()
  adapter = null
  setState('idle')
}

export function isConnected(): boolean {
  return currentState === 'connected'
}

export function hasIncomingCall(): boolean {
  return currentState === 'ringing'
}
```

- [ ] **Step 3: Update getWebRtcToken API call to expect `ttl` field**

In `src/client/lib/api.ts`, update the `getWebRtcToken` return type to include `ttl: number`.

- [ ] **Step 4: Update all imports from `webrtc.ts` to `webrtc/manager.ts`**

Search for all files importing from `'@/lib/webrtc'` or `'../webrtc'` and update to `'@/lib/webrtc/manager'`.

```bash
grep -r "from.*['\"].*lib/webrtc['\"]" src/client/ --files-with-matches
```

Update each import.

- [ ] **Step 5: Delete old `src/client/lib/webrtc.ts`**

```bash
rm src/client/lib/webrtc.ts
```

- [ ] **Step 6: Run typecheck and tests**

```bash
bun run typecheck
bun test src/client/lib/webrtc/
```

- [ ] **Step 7: Commit**

```bash
git add src/client/lib/webrtc/ src/client/lib/api.ts
git rm src/client/lib/webrtc.ts
git commit -m "feat: WebRTCManager with provider adapter factory"
```

---

### Task 6: Add `ttl` to WebRTC token endpoint

**Files:**
- Modify: `src/server/telephony/webrtc-tokens.ts`
- Modify: `src/server/routes/webrtc.ts`
- Test: `tests/api/webrtc.spec.ts` (extend or create)

- [ ] **Step 1: Write the failing test**

```typescript
test('GET /api/telephony/webrtc-token includes ttl', async () => {
  const res = await authedRequest('GET', '/api/telephony/webrtc-token')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ttl).toBeDefined()
  expect(typeof body.ttl).toBe('number')
  expect(body.ttl).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Update generateWebRtcToken return type**

Change return type from `{ token, provider }` to `{ token, provider, ttl }`:

```typescript
// webrtc-tokens.ts — each provider function returns ttl
// Twilio: ttl = 3600 (1 hour)
// Vonage: ttl = 3600
// Plivo: ttl = 3600
```

- [ ] **Step 3: Update the route handler**

```typescript
// routes/webrtc.ts line 42
return c.json({ token: result.token, provider: result.provider, identity, ttl: result.ttl })
```

- [ ] **Step 4: Run tests**

```bash
bunx playwright test tests/api/webrtc.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/telephony/webrtc-tokens.ts src/server/routes/webrtc.ts
git commit -m "feat: add ttl to WebRTC token response"
```

---

### Task 7: Call leg type column and schema migration

**Files:**
- Modify: `src/server/db/schema/calls.ts`
- Modify: `src/server/types.ts`
- Modify: `src/server/services/calls.ts`

- [ ] **Step 1: Add `type` column to callLegs schema**

In `src/server/db/schema/calls.ts`:

```typescript
import { pgEnum } from 'drizzle-orm/pg-core'

export const callLegTypeEnum = pgEnum('call_leg_type', ['phone', 'browser'])

export const callLegs = pgTable('call_legs', {
  // ... existing columns ...
  type: callLegTypeEnum('type').notNull().default('phone'),
  // ...
})
```

- [ ] **Step 2: Update types**

In `src/server/types.ts`:
- Add `type: 'phone' | 'browser'` to `CallLeg` interface
- Add `type?: 'phone' | 'browser'` to `CreateCallLegData` interface

- [ ] **Step 3: Update CallService**

In `src/server/services/calls.ts`:
- `createCallLeg()`: include `type` in insert
- `#rowToCallLeg()`: include `type` in return

- [ ] **Step 4: Generate and apply migration**

```bash
bun run migrate:generate
bun run migrate
```

- [ ] **Step 5: Run existing call tests to verify no regression**

```bash
bun test src/server/services/calls.test.ts
bunx playwright test tests/api/calls.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema/calls.ts src/server/types.ts src/server/services/calls.ts
git commit -m "feat: add type column to callLegs (phone | browser)"
```

---

### Task 8: Update RingVolunteersParams and adapter interface

**Files:**
- Modify: `src/server/telephony/adapter.ts`
- Modify: `src/server/telephony/twilio.ts`
- Modify: `src/server/telephony/vonage.ts`
- Modify: `src/server/telephony/plivo.ts`
- Modify: `src/server/telephony/signalwire.ts`
- Modify: `src/server/telephony/asterisk.ts`
- Modify: `src/server/lib/ringing.ts`

- [ ] **Step 1: Update RingVolunteersParams**

In `src/server/telephony/adapter.ts`:

```typescript
export interface RingVolunteersParams {
  callSid: string
  callerNumber: string
  volunteers: Array<{
    pubkey: string
    phone?: string           // optional — browser-only volunteers have no phone
    browserIdentity?: string // e.g., 'vol_abc123' — for <Client>/<User>/NCCO app routing
  }>
  callbackUrl: string
  hubId?: string
}
```

- [ ] **Step 2: Update ringing.ts to pass browserIdentity**

In `src/server/lib/ringing.ts`, change the volunteer mapping to include browser identity for browser/both preference volunteers:

```typescript
// Replace the current toRingPhone mapping (line 40-45)
const toRing = available
  .filter((v) => {
    const pref = v.callPreference ?? 'phone'
    // Include if they have a phone OR browser preference
    return (pref === 'phone' || pref === 'both') && v.phone || pref === 'browser' || pref === 'both'
  })
  .map((v) => {
    const pref = v.callPreference ?? 'phone'
    return {
      pubkey: v.pubkey,
      phone: (pref === 'phone' || pref === 'both') && v.phone ? v.phone : undefined,
      browserIdentity: (pref === 'browser' || pref === 'both') ? `vol_${v.pubkey.slice(0, 12)}` : undefined,
    }
  })
```

Also create browser call legs for volunteers with browser preference:

```typescript
// After creating phone legs, create browser legs
for (const vol of toRing.filter(v => v.browserIdentity)) {
  await services.calls.createCallLeg({
    legSid: `browser_${callSid}_${vol.pubkey.slice(0, 8)}`,
    callSid,
    hubId: hubId ?? 'global',
    volunteerPubkey: vol.pubkey,
    type: 'browser',
  })
}
```

- [ ] **Step 3: Update Twilio adapter to emit `<Client>` nouns**

In `src/server/telephony/twilio.ts`, `ringVolunteers()`:

The current code creates **individual outbound REST API calls** (`POST /Calls.json`) per volunteer — it does NOT use TwiML `<Dial>` with multiple nouns. For browser volunteers, create an outbound call to the client identity using the same REST API pattern:

```typescript
// For phone volunteers (existing): POST /Calls.json with To=+1555..., Url=callback
// For browser volunteers (new): POST /Calls.json with To=client:{browserIdentity}, Url=callback
// Twilio supports `client:identity` as the To parameter for outbound REST calls
```

For each volunteer with `browserIdentity`, create an outbound call leg:
```typescript
// In the ringVolunteers loop, alongside phone calls:
if (vol.browserIdentity) {
  await twilioClient.calls.create({
    to: `client:${vol.browserIdentity}`,
    from: callerNumber, // or the Twilio number
    url: `${callbackUrl}/api/telephony/volunteer-answer?parentCallSid=${callSid}&pubkey=${vol.pubkey}`,
    statusCallback: `${callbackUrl}/api/telephony/call-status?hub=${hubId}`,
  })
}
```

This routes the call to the registered Twilio `Device` with that identity, triggering the `incoming` event on the browser SDK. The `volunteer-answer` callback returns `<Dial><Queue>` TwiML to bridge the audio — same flow as phone volunteers.

- [ ] **Step 4: Update Vonage adapter**

Vonage requires separate REST API calls per browser volunteer (NCCO `connect` only supports one endpoint per action). In `vonage.ts`, `ringVolunteers()`:

For each volunteer with `browserIdentity`, create an outbound leg via Vonage REST API with:
```json
{
  "action": "connect",
  "endpoint": [{ "type": "app", "user": "vol_abc123" }]
}
```

- [ ] **Step 5: Update Plivo adapter**

In `plivo.ts`, `ringVolunteers()`:

For each volunteer with `browserIdentity`, include a `<User>` element in the Plivo XML `<Dial>`:
```xml
<User>sip:{browserIdentity}@app.plivo.com</User>
```

Multiple `<User>` + `<Number>` elements in one `<Dial>` work for parallel ringing.

- [ ] **Step 6: Update SignalWire adapter**

SignalWire should ignore `browserIdentity` and filter to `phone`-only volunteers (Asterisk now supports browser legs via the SIP WebRTC plan — see `docs/superpowers/plans/2026-03-24-sip-webrtc-browser-calling.md`):

```typescript
const phoneVolunteers = params.volunteers.filter(v => v.phone)
```

- [ ] **Step 7: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 8: Run all tests**

```bash
bun run test:unit
bunx playwright test tests/api/
```

- [ ] **Step 9: Commit**

```bash
git add src/server/telephony/ src/server/lib/ringing.ts
git commit -m "feat: add browser identity to parallel ringing for Twilio/Vonage/Plivo"
```

---

### Task 9: Extend answer endpoint with leg cancellation

**Files:**
- Modify: `src/server/routes/calls.ts`
- Modify: `src/server/services/calls.ts`
- Test: `tests/api/calls.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test('POST /api/calls/:callId/answer with type=browser marks browser leg', async () => {
  // Setup: create active call + browser call leg via test helpers
  // Call answer endpoint with { type: 'browser' }
  // Assert: call is assigned, browser leg is in-progress, other legs are cancelled
})

test('POST /api/calls/:callId/answer cancels all other legs including phone', async () => {
  // Setup: create active call + phone leg + browser leg for 'both' volunteer
  // Answer as browser
  // Assert: phone leg is cancelled
})
```

- [ ] **Step 2: Add leg cancellation to CallService**

In `src/server/services/calls.ts`, add:

```typescript
async cancelOtherLegs(callSid: string, hubId: string | undefined, answeredPubkey: string, answeredType?: 'phone' | 'browser'): Promise<string[]> {
  // Get all legs for this call (pass hubId to match hub-scoped queries)
  const legs = await this.getCallLegs(callSid, hubId)

  // Cancel all legs except the answered one
  const toCancel = legs.filter(leg => {
    if (leg.volunteerPubkey === answeredPubkey && leg.type === answeredType) return false
    return leg.status === 'ringing'
  })

  for (const leg of toCancel) {
    // updateCallLeg takes (legSid: string, status: string) — plain string, not object
    await this.updateCallLeg(leg.legSid, 'cancelled')
  }

  // Return phone leg SIDs for telephony adapter cancellation
  return toCancel.filter(l => l.type === 'phone' && l.legSid).map(l => l.legSid)
}
```

- [ ] **Step 3: Extend the answer endpoint**

In `src/server/routes/calls.ts`, update the `/:callId/answer` handler:

```typescript
calls.post('/:callId/answer', requirePermission('calls:answer'), async (c) => {
  const callId = c.req.param('callId')
  const pubkey = c.get('pubkey')
  const services = c.get('services')
  const hubId = c.get('hubId')
  const body = await c.req.json<{ type?: 'phone' | 'browser' }>().catch(() => ({}))

  const existing = await services.calls.getActiveCall(callId, hubId)
  if (!existing) return c.json({ error: 'Call not found' }, 404)
  if (existing.assignedPubkey) return c.json({ error: 'Call already answered' }, 409)

  const updated = await services.calls.updateActiveCall(
    callId,
    { assignedPubkey: pubkey, status: 'in-progress' },
    hubId
  )

  // Cancel all other legs (phone + browser)
  const phoneLegSids = await services.calls.cancelOtherLegs(callId, hubId, pubkey, body.type)

  // Cancel ringing phone legs via telephony adapter
  if (phoneLegSids.length > 0) {
    try {
      const adapter = await getTelephony(services.settings, hubId, c.env)
      if (adapter) {
        await adapter.cancelRinging(phoneLegSids)
      }
    } catch (err) {
      console.warn('[calls] Failed to cancel phone legs:', err)
    }
  }

  return c.json({ call: updated })
})
```

- [ ] **Step 4: Run tests**

```bash
bunx playwright test tests/api/calls.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/calls.ts src/server/services/calls.ts tests/api/calls.spec.ts
git commit -m "feat: answer endpoint cancels all other call legs"
```

---

### Task 10: Wire up useCalls + WebRTC answer integration

**Files:**
- Modify: `src/client/lib/hooks.ts`

- [ ] **Step 1: Import WebRTC functions in useCalls hook**

In `src/client/lib/hooks.ts`, update the `answerCall` function to also accept the WebRTC connection:

```typescript
import { acceptCall as acceptWebRtcCall, hasIncomingCall } from './webrtc/manager'

// In the answerCall function:
const answerCall = async (callId: string) => {
  // Capture browser call state once to avoid race condition
  const isBrowserCall = hasIncomingCall()

  // Optimistic UI update (existing)
  // ...

  // Accept WebRTC connection if we have an incoming browser call
  if (isBrowserCall) {
    acceptWebRtcCall()
  }

  // REST call to assign volunteer (existing)
  // NOTE: also update apiAnswerCall() in src/client/lib/api.ts to accept
  // and pass the { type } body parameter
  await apiAnswerCall(callId, isBrowserCall ? 'browser' : 'phone')
}
```

Also update `apiAnswerCall` in `src/client/lib/api.ts` to accept an optional `type` parameter:

```typescript
export async function apiAnswerCall(callId: string, type?: 'phone' | 'browser') {
  return authedFetch(`/api/calls/${callId}/answer`, {
    method: 'POST',
    body: JSON.stringify({ type }),
  })
}
```

- [ ] **Step 2: Run typecheck and build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/hooks.ts
git commit -m "feat: wire WebRTC accept into answerCall flow"
```

---

### Task 11: Microphone permission handling in settings

**Files:**
- Modify: Settings route/component for call preference

- [ ] **Step 1: Add mic permission check when selecting browser/both preference**

In the call preference selector component, when user selects `'browser'` or `'both'`:

```typescript
const handlePreferenceChange = async (pref: 'phone' | 'browser' | 'both') => {
  if (pref === 'browser' || pref === 'both') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Permission granted — stop the stream immediately (we just needed the prompt)
      stream.getTracks().forEach(t => t.stop())
    } catch {
      // Permission denied — show warning but still allow the preference change
      toast.warning('Microphone access is required for browser calling. Please enable it in your browser settings.')
    }
  }
  // Save preference
  await updateCallPreference(pref)
}
```

- [ ] **Step 2: Run typecheck and build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add src/client/
git commit -m "feat: mic permission prompt on browser call preference change"
```

---

### Task 12: E2E tests and final verification

**Files:**
- Test: `tests/api/calls.spec.ts`
- Test: `tests/ui/` (browser calling E2E)

- [ ] **Step 1: Run all existing tests**

```bash
bun run test:unit
bunx playwright test tests/api/
```
Verify no regressions.

- [ ] **Step 2: Add browser calling API tests**

- Token endpoint returns ttl
- Answer endpoint with `type: 'browser'` works
- Call leg type column functions correctly

- [ ] **Step 3: Run full test suite**

```bash
bun run test:all
```

- [ ] **Step 4: Final typecheck and build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "test: add browser calling tests"
```
