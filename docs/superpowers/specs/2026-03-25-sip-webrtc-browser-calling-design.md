# SIP WebRTC Browser Calling (JsSIP)

**Date:** 2026-03-25
**Status:** Draft
**Depends on:** Browser Calling plan (2026-03-24) — `WebRTCAdapter` interface and `WebRTCManager` must be implemented first
**Providers:** Any self-hosted SIP server with WSS transport (Asterisk, FreeSWITCH, Kamailio, etc.)

## Overview

Volunteers using a self-hosted SIP telephony provider (Asterisk, FreeSWITCH, etc.) can answer calls directly in the browser via WebRTC. The client uses **JsSIP** for SIP signaling over WSS; the browser's native `RTCPeerConnection` handles DTLS-SRTP encrypted media. Server-side endpoint provisioning flows through the asterisk-bridge (or equivalent) to maintain centralized ARI access.

This spec implements the `SipWebRTCAdapter` referenced as "separate spec" in the [Browser Calling design](2026-03-24-web-push-browser-calling-design.md). It plugs into the same `WebRTCAdapter` interface and `WebRTCManager` state machine used by Twilio/Vonage/Plivo adapters.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SIP library | JsSIP (v3.13.x) | Actively maintained (7 releases in 2026), author maintains mediasoup, ships `.d.ts` types. SIP.js is abandoned (no npm release since Oct 2022, 90 open issues). |
| Adapter naming | `SipWebRTCAdapter` (generic) | Works with any SIP server exposing WSS — not Asterisk-specific. Factory matches `'asterisk'`, `'freeswitch'`, `'kamailio'`, `'sip'`. |
| Provisioning path | Hono → Bridge → ARI | Keeps ARI access centralized in the bridge. Provisioning commands use existing HMAC-signed `bridgeRequest()` channel. JsSIP ↔ Asterisk WSS traffic bypasses the bridge (direct SIP signaling). |
| Endpoint naming | `vol_{pubkey.slice(0,12)}` | Deterministic from volunteer identity, collision-resistant with 12 hex chars (48 bits). Browser calling plan must be updated to use 12 chars (not 16) for `browserIdentity` to match. |
| Endpoint credentials | CSPRNG password, per-session delivery | Password generated on provision, delivered via token endpoint. Never persisted on client. Rotatable by reprovisioning. |
| PJSIP `webrtc=yes` | Use Asterisk's built-in WebRTC preset | Auto-enables DTLS, ICE, AVPF, opus — no manual SDP configuration. |
| `max_contacts: 1` | One browser registration per volunteer | Matches parallel ringing model — one browser leg per volunteer. Multiple devices handled by separate legs. |
| STUN/TURN | Configurable via env vars | `STUN_SERVER`, `TURN_SERVER`, `TURN_USERNAME`, `TURN_CREDENTIAL`. Defaults to Google public STUN for dev; production should use coturn. |
| Media encryption | Browser DTLS-SRTP (mandatory) | Neither JsSIP nor SIP.js implement SRTP — the browser's WebRTC stack handles it per RFC 8827. Asterisk's `media_encryption=dtls` enables the server side. |
| WSS transport port | 8089 | Standard Asterisk HTTP/WebSocket port. Exposed in Docker Compose and Ansible. |
| Provisioner interface | `SipEndpointProvisioner` | Generic interface for endpoint CRUD. `AsteriskProvisioner` is first implementation; FreeSWITCH/Kamailio get their own implementations when needed. |

---

## Architecture

### Component Boundaries

```
Browser                          Hono Server              Asterisk Bridge           Asterisk
┌───────────────────┐            ┌──────────────┐         ┌──────────────────┐      ┌──────────┐
│ SipWebRTCAdapter  │            │              │         │                  │      │          │
│  └─ JsSIP UA      │◄══WSS════►│              │         │  PJSIP endpoint  │      │  PJSIP   │
│     └─ RTCSession │   (SIP    │              │         │  lives here      │      │  engine   │
│        └─ RTC PC  │  signaling│              │         │                  │      │          │
│           (media) │◄═══DTLS-SRTP═══════════════════════════════════════════════►│  (media) │
│                   │            │              │  HMAC   │                  │ ARI  │          │
│ WebRTCManager     │            │ Asterisk     │◄═══════►│ CommandHandler   │◄════►│  REST    │
│  └─ state machine │            │  Adapter     │  REST   │  provision-ep   │      │  API     │
│                   │            │  .bridgeReq()│         │  deprovision-ep  │      │          │
└───────────────────┘            └──────────────┘         └──────────────────┘      └──────────┘

Legend:
  ═══  Network boundary (encrypted)
  WSS  SIP signaling (WebSocket Secure, TLS)
  DTLS-SRTP  Encrypted media (browser ↔ Asterisk direct, bridge NOT in path)
  HMAC REST  Existing bridge command channel (X-Bridge-Signature authenticated)
  ARI  Asterisk REST Interface (bridge ↔ Asterisk, internal network)
```

### Key Principle: Bridge Is Not in the Audio/Signaling Path

The asterisk-bridge has two roles:
1. **Runtime event relay** — translates ARI WebSocket events into HTTP webhooks (existing, unchanged)
2. **Configuration commands** — provisions/deprovisions PJSIP endpoints via ARI REST (new)

SIP signaling (INVITE, 200 OK, BYE) flows directly between the browser's JsSIP UA and Asterisk's PJSIP over WSS. Media (RTP) flows directly between the browser's RTCPeerConnection and Asterisk. The bridge sees ARI events for these sessions (StasisStart, ChannelStateChange, etc.) but is not a relay.

---

## Client-Side: SipWebRTCAdapter

### Implementation

`src/client/lib/webrtc/adapters/sip.ts` — implements `WebRTCAdapter` from the browser calling plan.

```typescript
import type { WebRTCAdapter, WebRtcEvent, WebRtcEventHandler } from '../types'

interface SipTokenPayload {
  wsUri: string          // wss://asterisk.example.com:8089/ws
  sipUri: string         // sip:vol_abc123def456@asterisk.example.com
  password: string       // CSPRNG-generated, per-session
  iceServers: Array<{
    urls: string | string[]
    username?: string
    credential?: string
  }>
}

export class SipWebRTCAdapter implements WebRTCAdapter {
  #ua: JsSIPUserAgent | null = null
  #session: JsSIPRTCSession | null = null
  #handlers = new Map<string, Set<(...args: unknown[]) => void>>()
  #iceServers: RTCIceServer[] = []

  async initialize(token: string): Promise<void> {
    const config: SipTokenPayload = JSON.parse(atob(token))
    this.#iceServers = config.iceServers

    const JsSIP = await import(/* @vite-ignore */ 'jssip')
    const socket = new JsSIP.WebSocketInterface(config.wsUri)

    this.#ua = new JsSIP.UA({
      sockets: [socket],
      uri: config.sipUri,
      password: config.password,
      register: true,
      register_expires: 600,
      session_timers: false,
      user_agent: 'Hotline/1.0',  // Generic — no app name leak
    })

    this.#ua.on('registrationFailed', (e: { cause: string }) => {
      this.#emit('error', new Error(`SIP registration failed: ${e.cause}`))
    })

    // Handle WebSocket disconnect (network loss, server restart)
    this.#ua.on('disconnected', () => {
      this.#emit('error', new Error('SIP WebSocket disconnected'))
    })

    this.#ua.on('newRTCSession', (e: { session: JsSIPRTCSession; originator: string }) => {
      if (e.originator !== 'remote') return  // only handle incoming calls

      // Reject second incoming call if one is already active
      if (this.#session) {
        e.session.terminate({ status_code: 486, reason_phrase: 'Busy Here' })
        return
      }

      this.#session = e.session
      const callId = e.session.remote_identity?.uri?.user ?? ''

      e.session.on('accepted', () => this.#emit('connected'))
      e.session.on('ended', () => {
        this.#session = null
        this.#emit('disconnected')
      })
      e.session.on('failed', (ev: { cause: string }) => {
        this.#session = null
        this.#emit('error', new Error(`Call failed: ${ev.cause}`))
      })

      this.#emit('incoming', callId)
    })

    this.#ua.start()

    // Wait for initial registration before resolving.
    // Uses one-shot handlers to avoid double-binding with the persistent
    // registrationFailed listener above (which handles re-registration failures).
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const onRegistered = () => {
        if (settled) return
        settled = true
        resolve()
      }
      const onFailed = (e: { cause: string }) => {
        if (settled) return
        settled = true
        reject(new Error(`SIP initial registration failed: ${e.cause}`))
      }
      this.#ua!.on('registered', onRegistered)
      this.#ua!.on('registrationFailed', onFailed)
    })
  }

  async accept(_callSid: string): Promise<void> {
    this.#session?.answer({
      mediaConstraints: { audio: true, video: false },
      pcConfig: {
        iceServers: this.#iceServers,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      },
      rtcOfferConstraints: {
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      },
    })
  }

  async reject(_callSid: string): Promise<void> {
    this.#session?.terminate({ status_code: 486, reason_phrase: 'Busy Here' })
    this.#session = null
  }

  disconnect(): void {
    this.#session?.terminate()
    this.#session = null
  }

  setMuted(muted: boolean): void {
    if (muted) {
      this.#session?.mute({ audio: true })
    } else {
      this.#session?.unmute({ audio: true })
    }
  }

  isMuted(): boolean {
    return this.#session?.isMuted()?.audio ?? false
  }

  on<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set())
    this.#handlers.get(event)!.add(handler as (...args: unknown[]) => void)
  }

  off<E extends WebRtcEvent>(event: E, handler: WebRtcEventHandler<E>): void {
    this.#handlers.get(event)?.delete(handler as (...args: unknown[]) => void)
  }

  destroy(): void {
    this.#session?.terminate()
    this.#session = null
    this.#ua?.stop()
    this.#ua = null
    this.#handlers.clear()
  }

  #emit(event: string, ...args: unknown[]): void {
    this.#handlers.get(event)?.forEach((h) => h(...args))
  }
}
```

### WebRTCManager Factory Integration

In `src/client/lib/webrtc/manager.ts`, the `createAdapter()` function gains:

```typescript
case 'asterisk':
case 'freeswitch':
case 'kamailio':
case 'sip':
  return new SipWebRTCAdapter()
```

### JsSIP Type Declarations

JsSIP ships `.d.ts` types. If they prove insufficient, create `src/client/types/jssip.d.ts` with minimal interfaces for `UA`, `RTCSession`, and `WebSocketInterface`. The adapter uses private `#` fields with local type aliases (`JsSIPUserAgent`, `JsSIPRTCSession`) to decouple from JsSIP's exported types — if the types change between versions, only the aliases need updating.

---

## Server-Side: SIP Endpoint Provisioning

### SipEndpointProvisioner Interface

`src/server/telephony/sip-provisioner.ts` — generic interface for any SIP server:

```typescript
export interface SipEndpointConfig {
  sipUri: string
  username: string
  password: string
  wsUri: string
  iceServers: Array<{
    urls: string | string[]
    username?: string
    credential?: string
  }>
}

export interface SipEndpointProvisioner {
  /** Create or update a WebRTC-capable SIP endpoint for a volunteer */
  provisionEndpoint(pubkey: string): Promise<SipEndpointConfig>

  /** Remove a volunteer's SIP endpoint */
  deprovisionEndpoint(pubkey: string): Promise<void>

  /** Check if an endpoint exists and is healthy */
  checkEndpoint(pubkey: string): Promise<boolean>
}
```

### AsteriskProvisioner

`src/server/telephony/asterisk-provisioner.ts` — calls the bridge's new command routes:

```typescript
export class AsteriskProvisioner implements SipEndpointProvisioner {
  constructor(
    private bridgeCallbackUrl: string,
    private bridgeSecret: string,
    private asteriskDomain: string,
    private wssPort: number,
    private stunServer: string,
    private turnServer?: string,
    private turnUsername?: string,
    private turnCredential?: string,
  ) {}

  async provisionEndpoint(pubkey: string): Promise<SipEndpointConfig> {
    const result = await this.bridgeRequest('POST', '/commands/provision-endpoint', { pubkey })
    const { username, password } = result as { username: string; password: string }

    const iceServers: SipEndpointConfig['iceServers'] = [
      { urls: this.stunServer },
    ]
    if (this.turnServer) {
      iceServers.push({
        urls: this.turnServer,
        username: this.turnUsername,
        credential: this.turnCredential,
      })
    }

    return {
      sipUri: `sip:${username}@${this.asteriskDomain}`,
      username,
      password,
      wsUri: `wss://${this.asteriskDomain}:${this.wssPort}/ws`,
      iceServers,
    }
  }

  async deprovisionEndpoint(pubkey: string): Promise<void> {
    await this.bridgeRequest('POST', '/commands/deprovision-endpoint', { pubkey })
  }

  async checkEndpoint(pubkey: string): Promise<boolean> {
    // Check via bridge — bridge queries ARI for the endpoint
    try {
      const result = await this.bridgeRequest('POST', '/commands/check-endpoint', { pubkey })
      return (result as { exists: boolean }).exists
    } catch {
      return false
    }
  }

  // Uses identical HMAC-signed request pattern as AsteriskAdapter.bridgeRequest()
  private async bridgeRequest(method: string, path: string, body?: unknown): Promise<unknown> {
    // ... same HMAC signing as AsteriskAdapter — extract to shared utility
  }
}
```

**Note on DRY:** `AsteriskAdapter` and `AsteriskProvisioner` both use `bridgeRequest()` with identical HMAC signing. During implementation, extract the signing logic into a shared `BridgeClient` class that both consume. This avoids duplicating the HMAC logic.

### Token Generation

In `src/server/telephony/webrtc-tokens.ts`, replace the Asterisk throw with:

```typescript
case 'asterisk': {
  const provisioner = getAsteriskProvisioner(config)
  const endpoint = await provisioner.provisionEndpoint(identity)
  const token = btoa(JSON.stringify({
    wsUri: endpoint.wsUri,
    sipUri: endpoint.sipUri,
    password: endpoint.password,
    iceServers: endpoint.iceServers,
  }))
  return { token, provider: 'asterisk', ttl: 600 }
}
```

The `ttl: 600` matches the SIP registration expiry (10 minutes). The `WebRTCManager` schedules token refresh at `ttl - 60s` as specified in the browser calling plan.

### Endpoint Lifecycle

Endpoints are provisioned lazily and deprovisioned explicitly:

| Event | Action |
|-------|--------|
| Volunteer sets call preference to `browser`/`both` | Provision on first token request (idempotent) |
| Token refresh (every ~540s) | Re-provision (idempotent, password may change) |
| Volunteer sets call preference to `phone` only | Deprovision endpoint |
| Volunteer deactivated/deleted by admin | Deprovision endpoint |
| SIP registration expires (600s) | No action — re-registration handled by JsSIP `register_expires` |
| Volunteer goes off-shift | No deprovision — endpoint stays; ringing logic already filters by shift status |

Stale endpoints (volunteer deactivated but not deprovisioned) are harmless — Asterisk won't route calls to unregistered endpoints. A periodic cleanup job can be added later if needed.

### isWebRtcConfigured

In the same file, add Asterisk support:

```typescript
case 'asterisk':
  return !!(config.ariUrl && config.bridgeCallbackUrl)
```

---

## Asterisk-Bridge Extensions

### New Command Routes

In `asterisk-bridge/src/command-handler.ts`:

**`POST /commands/provision-endpoint`**
- Body: `{ pubkey: string }`
- Returns: `{ username: string, password: string }`
- Steps:
  1. Derive username: `vol_${pubkey.slice(0, 12)}`
  2. Generate password: 32 bytes CSPRNG → base64url
  3. `ari.configureDynamic('res_pjsip', 'auth', username, { auth_type: 'userpass', username, password })`
  4. `ari.configureDynamic('res_pjsip', 'aor', username, { max_contacts: '1', remove_existing: 'yes', qualify_frequency: '30' })`
  5. `ari.configureDynamic('res_pjsip', 'endpoint', username, { auth: username, aors: username, webrtc: 'yes', transport: 'transport-wss', context: 'volunteers', dtls_auto_generate_cert: 'yes', media_encryption: 'dtls', disallow: 'all', allow: 'opus,ulaw' })`
  6. Return `{ username, password }`
- Idempotent: ARI `PUT` overwrites existing objects with same ID — safe to call repeatedly

**`res_pjsip` module reload — avoid during live calls:**
The existing `PjsipConfigurator` reloads `res_pjsip.so` after trunk provisioning at startup, which is safe. For per-volunteer provisioning during live calls, a reload would disrupt ALL active SIP sessions. With the `memory` sorcery wizard (configured in `sorcery.conf`), dynamic config changes via ARI should take effect immediately without a reload. During implementation:
1. Test whether provisioned endpoints work WITHOUT a reload
2. If a reload IS required, debounce it — batch pending provisions and reload once after all are complete, and only when no active calls are in progress

**`POST /commands/deprovision-endpoint`**
- Body: `{ pubkey: string }`
- Steps:
  1. Derive username: `vol_${pubkey.slice(0, 12)}`
  2. `ari.deleteDynamic('res_pjsip', 'endpoint', username)`
  3. `ari.deleteDynamic('res_pjsip', 'aor', username)`
  4. `ari.deleteDynamic('res_pjsip', 'auth', username)`
  5. (Skip `reloadModule` during live calls — see provisioning note above)

**`POST /commands/check-endpoint`**
- Body: `{ pubkey: string }`
- Returns: `{ exists: boolean }`
- Queries ARI: `GET /asterisk/config/dynamic/res_pjsip/endpoint/vol_xxx`

### ARI Client Addition

In `asterisk-bridge/src/ari-client.ts`, add one method:

```typescript
/** Delete a dynamic config object via ARI */
async deleteDynamic(
  configClass: string,
  objectType: string,
  id: string,
): Promise<void> {
  await this.request('DELETE',
    `/asterisk/config/dynamic/${configClass}/${objectType}/${id}`)
}
```

### Asterisk Configuration Changes

**`asterisk-bridge/asterisk-config/pjsip.conf`** — add WSS transport:

```ini
; ----------------------------------------------------------
; Transport — WSS on port 8089 (WebRTC browser clients)
; ----------------------------------------------------------
[transport-wss]
type = transport
protocol = wss
bind = 0.0.0.0:8089
```

**`asterisk-bridge/asterisk-config/http.conf`** — enable Asterisk HTTP/WebSocket server:

```ini
[general]
enabled = yes
bindaddr = 0.0.0.0
bindport = 8088
; TLS for WSS — required for browser WebSocket connections
tlsenable = yes
tlsbindaddr = 0.0.0.0:8089
tlscertfile = /etc/asterisk/keys/asterisk.pem
tlsprivatekey = /etc/asterisk/keys/asterisk.key
```

**`asterisk-bridge/asterisk-config/extensions.conf`** — volunteer context:

```ini
[volunteers]
; WebRTC browser endpoints route here — forward to bridge stasis app
exten => _X.,1,Stasis(llamenos)
 same => n,Hangup()
```

### Docker Compose Changes

In `docker-compose.dev.yml`, expose WSS port from Asterisk container:

```yaml
asterisk:
  ports:
    - "${ASTERISK_WSS_PORT:-8089}:8089"   # WSS for browser SIP clients
  environment:
    - ASTERISK_WSS_PORT=${ASTERISK_WSS_PORT:-8089}
```

TLS for local dev: generate self-signed cert at container startup or mount dev certs. For production, the reverse proxy (Caddy/nginx) terminates TLS and proxies WSS to Asterisk's HTTP listener.

### Ansible / Production Changes

- Expose port 8089 in Asterisk container
- TLS cert provisioning (Let's Encrypt via reverse proxy, or direct cert mount)
- New env vars in `demo_vars.example.yml`:
  - `ASTERISK_WSS_PORT` (default: 8089)
  - `STUN_SERVER` (default: `stun:stun.l.google.com:19302`)
  - `TURN_SERVER` (optional)
  - `TURN_USERNAME` (optional)
  - `TURN_CREDENTIAL` (optional)

---

## Call Flow: Incoming Call to Browser via SIP

```
1. Caller dials PSTN number
2. SIP trunk delivers call to Asterisk
3. Asterisk routes to bridge stasis app (existing)
4. Bridge sends webhook to Hono server (existing)
5. Hono CallRouterService determines ring group (existing)
6. For each volunteer with browser calling:
   a. Hono → AsteriskAdapter.ringVolunteers() includes browserIdentity
   b. Bridge command: originate call to PJSIP/vol_xxx endpoint
   c. Asterisk sends SIP INVITE over WSS to browser
   d. JsSIP UA receives INVITE, fires 'newRTCSession'
   e. SipWebRTCAdapter emits 'incoming'
   f. WebRTCManager → state 'ringing'
   g. Push notification also fires (Web Push plan, parallel)
7. Volunteer clicks Answer:
   a. SipWebRTCAdapter.accept() → JsSIP session.answer()
   b. Browser ↔ Asterisk negotiate DTLS-SRTP (direct, not through bridge)
   c. POST /api/calls/{callId}/answer { type: 'browser' }
   d. CallRouterService cancels other ringing legs
   e. Bridge receives ARI hangup events for cancelled legs
8. Call in progress: audio flows browser ↔ Asterisk ↔ PSTN caller
9. Volunteer clicks Hangup:
   a. SipWebRTCAdapter.disconnect() → JsSIP session.terminate()
   b. Asterisk receives BYE, tears down both legs
   c. Bridge sends call-complete webhook to Hono
```

### Parallel Ringing with Mixed Leg Types

When `callPreference: 'both'`, a volunteer gets two parallel legs:
- **Phone leg**: existing flow — bridge originates PSTN call to volunteer's phone
- **Browser leg**: new flow — bridge originates call to `PJSIP/vol_xxx`

First answer wins (existing atomic `assignedPubkey` check on `activeCalls` row). The answer endpoint cancels the losing leg regardless of type.

### AsteriskAdapter.ringVolunteers() Changes

The `ringVolunteers` command payload to the bridge is extended:

```typescript
volunteers: volunteers.map((v) => ({
  pubkey: v.pubkey,
  phone: v.phone,              // optional — ring phone if present
  browserIdentity: v.browserIdentity,  // optional — ring PJSIP/vol_xxx if present
}))
```

The bridge's ring handler:
- For `phone`: originates call via SIP trunk (existing)
- For `browserIdentity`: originates call via `PJSIP/${browserIdentity}` (new)
- For both: originates both in parallel

The browser leg's ARI channel has `endpoint: PJSIP/vol_xxx` — the bridge includes `legType: 'browser'` in status webhooks so the Hono server can track leg type.

---

## Testing Strategy

### Unit Tests (`bun:test`)

**`src/client/lib/webrtc/adapters/sip.test.ts`**
- `initialize()` creates JsSIP UA with correct config, calls `ua.start()`, resolves on `registered`
- `accept()` calls `session.answer()` with correct `pcConfig` and `mediaConstraints`
- `reject()` calls `session.terminate()` with status 486
- `disconnect()` terminates active session
- `setMuted(true)` calls `session.mute({ audio: true })`, `setMuted(false)` calls `session.unmute()`
- `isMuted()` returns `session.isMuted().audio`
- `destroy()` calls `ua.stop()`, nullifies references, clears handlers
- Event mapping: `newRTCSession` (remote) → `incoming`, `accepted` → `connected`, `ended` → `disconnected`, `failed` → `error`
- Ignores outgoing sessions (`originator !== 'remote'`)
- Rejects second incoming session if one is already active (busy)
- WSS disconnect emits error event
- `initialize()` with wrong credentials rejects with registration failure
- Mock JsSIP module for all tests

**`src/server/telephony/asterisk-provisioner.test.ts`**
- `provisionEndpoint()` sends correct command payload, returns `SipEndpointConfig`
- `deprovisionEndpoint()` sends delete command
- Username derivation: `vol_${pubkey.slice(0,12)}` — deterministic, consistent
- ICE servers constructed from env vars (STUN always, TURN when configured)
- `checkEndpoint()` returns `true`/`false` based on bridge response

**`asterisk-bridge/src/command-handler.test.ts`** (bridge-side)
- `provision-endpoint`: mock ARI REST, verify 3 `configureDynamic` calls (no `reloadModule` — see reload guidance above)
- `deprovision-endpoint`: mock ARI REST, verify 3 `deleteDynamic` calls (no `reloadModule`)
- `check-endpoint`: mock ARI REST, verify GET request
- HMAC authentication enforced on all new commands
- Error handling: ARI failure returns error, no partial config left behind
- Partial provisioning rollback: if step 3 (endpoint) fails, clean up auth and aor from steps 1-2

### API Integration Tests (`tests/api/`)

- `GET /api/telephony/webrtc-token` with Asterisk provider config → returns valid base64-encoded SIP credentials
- Token payload contains `wsUri`, `sipUri`, `password`, `iceServers`
- Provisioning is idempotent — two requests for same volunteer return same username (password may differ)
- `isWebRtcConfigured()` returns `true` for Asterisk configs with `ariUrl` + `bridgeCallbackUrl`

### E2E Tests Against Local Asterisk (`tests/ui/`)

Requires `bun run dev:docker` running (Asterisk container with WSS enabled).

**TLS prerequisite for local WSS:** Browsers reject self-signed certs for WebSocket connections. For local E2E tests:
- Use `mkcert` to generate locally-trusted TLS certs, mount into the Asterisk container
- Playwright tests can bypass cert validation via `ignoreHTTPSErrors: true` in browser context options
- Add a setup script or Docker entrypoint that generates dev certs if not present
This is a **blocking prerequisite** — WSS will not work without valid TLS. Must be addressed as a dedicated implementation task.

**`tests/ui/sip-browser-calling.spec.ts`**:
1. Bridge provisions a real PJSIP endpoint via ARI dynamic config
2. Playwright loads the dashboard, JsSIP registers over WSS to local Asterisk
3. Bridge originates a test call via ARI `POST /channels` to `PJSIP/vol_xxx`
4. JsSIP receives the INVITE, adapter emits `incoming`, UI shows ringing state
5. Test clicks Answer, verifies `connected` state
6. Verify `RTCPeerConnection.connectionState === 'connected'` and active audio track via `page.evaluate()`
7. Test clicks Hangup, verifies `disconnected` → `ready` transition
8. Cleanup: deprovision endpoint

**Media verification:** We don't need to hear audio — verify that `RTCPeerConnection` reaches `connected` state and has an active `RTCRtpReceiver` with `track.kind === 'audio'`.

---

## Files to Create or Modify

### New Files
- `src/client/lib/webrtc/adapters/sip.ts` — `SipWebRTCAdapter`
- `src/client/lib/webrtc/adapters/sip.test.ts` — unit tests
- `src/server/telephony/sip-provisioner.ts` — `SipEndpointProvisioner` interface
- `src/server/telephony/asterisk-provisioner.ts` — `AsteriskProvisioner` implementation
- `src/server/telephony/asterisk-provisioner.test.ts` — unit tests
- `src/server/telephony/bridge-client.ts` — shared HMAC-signed request utility (extracted from `AsteriskAdapter`)
- `tests/ui/sip-browser-calling.spec.ts` — E2E tests against local Asterisk

### Modified Files
- `src/client/lib/webrtc/manager.ts` — add `'asterisk'`/`'freeswitch'`/`'kamailio'`/`'sip'` cases to `createAdapter()`
- `src/server/telephony/webrtc-tokens.ts` — replace Asterisk throw with provisioner + token generation; add `isWebRtcConfigured` for Asterisk
- `src/server/telephony/asterisk.ts` — use `BridgeClient` instead of inline `bridgeRequest()`; extend `ringVolunteers` to include browser endpoints
- `asterisk-bridge/src/command-handler.ts` — add `provision-endpoint`, `deprovision-endpoint`, `check-endpoint` commands
- `asterisk-bridge/src/ari-client.ts` — add `deleteDynamic()` method
- `asterisk-bridge/asterisk-config/pjsip.conf` — add `[transport-wss]`
- `asterisk-bridge/asterisk-config/http.conf` — enable TLS/WSS listener
- `asterisk-bridge/asterisk-config/extensions.conf` — add `[volunteers]` context
- `docker-compose.dev.yml` — expose port 8089 from Asterisk container
- `deploy/ansible/demo_vars.example.yml` — add WSS/STUN/TURN env vars
- `.env.example` — add `STUN_SERVER`, `TURN_SERVER`, `TURN_USERNAME`, `TURN_CREDENTIAL`

---

## Out of Scope

- FreeSWITCH `SipEndpointProvisioner` implementation (interface is ready, implementation when needed)
- Kamailio `SipEndpointProvisioner` implementation
- Outbound calls from browser (incoming-only for MVP)
- Video calling
- SIP presence/BLF (busy lamp field)
- SRTP key management (handled by browser + Asterisk DTLS negotiation)
- coturn deployment (infrastructure, documented in Ansible vars)

---

## Plan Updates Required

The browser calling plan (`docs/superpowers/plans/2026-03-24-browser-calling.md`) needs these updates before this spec is implemented:

1. **Remove Asterisk from "ignore browserIdentity" list** — the plan currently says Asterisk should ignore `browserIdentity` for now. This spec adds browser leg support for Asterisk, so the plan should be updated to include Asterisk in the browser-leg-aware adapters.
2. **Standardize `browserIdentity` length to 12 hex chars** — the plan uses `pubkey.slice(0, 16)` for `browserIdentity` in `ringing.ts`. This spec uses `pubkey.slice(0, 12)` for PJSIP endpoint names. Standardize to 12 (48 bits is sufficient for collision resistance among volunteers; SIP endpoint names have practical length limits).

## Dependencies

- **Browser Calling plan (2026-03-24)** must be implemented first — provides `WebRTCAdapter` interface, `WebRTCManager`, `createAdapter()` factory, `callLegs.type` schema, and answer endpoint with leg cancellation
- **Web Push plan (2026-03-24)** — push notifications work in parallel with SIP ringing (no code dependency, but the UX integration applies)
- **JsSIP npm package** — `bun add jssip`
- **Asterisk container** — WSS transport enabled, `http.conf` configured for TLS
