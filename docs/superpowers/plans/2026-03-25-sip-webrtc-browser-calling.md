# SIP WebRTC Browser Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Volunteers using self-hosted SIP providers (Asterisk, FreeSWITCH, Kamailio) can answer calls directly in the browser via JsSIP WebRTC, with full deployment support in Docker Compose and Ansible.

**Architecture:** Client-side `SipWebRTCAdapter` wraps JsSIP for SIP/WSS signaling and browser DTLS-SRTP media. Server-side `AsteriskProvisioner` provisions PJSIP WebRTC endpoints through the sip-bridge's new `/provision-endpoint` command. Caddy reverse proxy terminates TLS and proxies WSS to Asterisk. coturn provides TURN relay for NAT traversal. All infrastructure is managed via Ansible templates.

**Tech Stack:** JsSIP v3.13.x, Asterisk PJSIP (WebRTC mode), coturn, Caddy (WSS proxy), Bun, Hono, Drizzle ORM

**Spec:** `docs/superpowers/specs/2026-03-25-sip-webrtc-browser-calling-design.md`

**Depends on:** Browser Calling plan (`docs/superpowers/plans/2026-03-24-browser-calling.md`) — `WebRTCAdapter` interface, `WebRTCManager`, `createAdapter()` factory must exist before Task 5.

**IMPORTANT — Bridge route path convention:** The bridge uses flat paths (`/ring`, `/hangup`, `/provision-endpoint`). The existing `AsteriskAdapter` uses `/commands/` prefixed paths (`/commands/ring`, `/commands/hangup`). Verify which convention is actually working before implementing — there may be a pre-existing path mismatch or a proxy prefix. All new provisioner routes in this plan use flat paths to match the bridge's `index.ts` route handlers.

**IMPORTANT — TURN credential mechanism:** coturn is configured with `use-auth-secret` (time-limited HMAC credentials per RFC 5766), NOT static username/password. The `AsteriskProvisioner` must compute TURN credentials at token generation time using `HMAC-SHA1(turnSecret, timestamp:identity)`. See Task 4 for implementation details.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/client/lib/webrtc/adapters/sip.ts` | `SipWebRTCAdapter` — JsSIP wrapper implementing `WebRTCAdapter` |
| `src/server/telephony/sip-provisioner.ts` | `SipEndpointProvisioner` interface |
| `src/server/telephony/asterisk-provisioner.ts` | `AsteriskProvisioner` — provisions endpoints via bridge commands |
| `src/server/telephony/bridge-client.ts` | Shared HMAC-signed HTTP client for bridge commands |
| `sip-bridge/src/index.ts` | New `/provision-endpoint`, `/deprovision-endpoint`, `/check-endpoint` routes |
| `sip-bridge/src/ari-client.ts` | Add `deleteDynamic()` method |
| `sip-bridge/asterisk-config/pjsip.conf` | Add `[transport-wss]` stanza |
| `sip-bridge/asterisk-config/http.conf` | Enable TLS/WSS listener on port 8089 |
| `sip-bridge/asterisk-config/extensions.conf` | Add `[volunteers]` dialplan context |
| `deploy/ansible/templates/docker-compose.j2` | Add coturn service, Asterisk WSS port, Caddy WSS route |
| `deploy/ansible/templates/caddy.j2` | Add `/ws` WSS proxy route to Asterisk |
| `deploy/ansible/templates/env.j2` | Add STUN/TURN/WSS env vars |
| `deploy/ansible/demo_vars.example.yml` | Add coturn, STUN/TURN, WSS config vars |
| `deploy/ansible/vars.example.yml` | Same additions for production |
| `docker-compose.dev.yml` | Add coturn service, Asterisk WSS port |

---

### Task 1: Asterisk Configuration — WSS Transport & Volunteer Dialplan

**Files:**
- Modify: `sip-bridge/asterisk-config/pjsip.conf`
- Modify: `sip-bridge/asterisk-config/http.conf`
- Modify: `sip-bridge/asterisk-config/extensions.conf`

- [ ] **Step 1: Add WSS transport to pjsip.conf**

```ini
; ----------------------------------------------------------
; Transport — WSS on port 8089 (WebRTC browser clients)
; SIP-over-WebSocket signaling for JsSIP browser UA.
; Caddy terminates TLS in production; for local dev, Asterisk
; serves WSS directly with self-signed or mkcert certs.
; ----------------------------------------------------------
[transport-wss]
type = transport
protocol = wss
bind = 0.0.0.0:8089
```

Append after the existing `[transport-tcp]` stanza in `sip-bridge/asterisk-config/pjsip.conf`.

- [ ] **Step 2: Enable Asterisk HTTP/WebSocket server with TLS in http.conf**

Replace the existing `http.conf` with:

```ini
; ============================================================
; HTTP Server Configuration for Asterisk ARI + WebSocket
; ============================================================
; The ARI WebSocket and REST API run over Asterisk's built-in
; HTTP server. The bridge service connects via port 8088.
; Browser JsSIP clients connect via WSS on port 8089.
;
; Place this file in /etc/asterisk/http.conf
; ============================================================

[general]
enabled = yes
bindaddr = 0.0.0.0
bindport = 8088

; TLS for WebSocket Secure (WSS) — required for browser SIP clients.
; In production, Caddy terminates TLS and proxies to plain WS on 8088.
; For local dev/testing, enable direct TLS on 8089 with mkcert certs.
tlsenable = yes
tlsbindaddr = 0.0.0.0:8089
tlscertfile = /etc/asterisk/keys/asterisk.pem
tlsprivatekey = /etc/asterisk/keys/asterisk.key
```

- [ ] **Step 3: Add volunteers dialplan context to extensions.conf**

Append after the `[internal]` context:

```ini
; ----------------------------------------------------------
; WebRTC browser endpoints (SIP-over-WSS via JsSIP)
; ----------------------------------------------------------
; Dynamically provisioned PJSIP endpoints for volunteers with
; browser calling. Routed to Stasis for bridge management.
[volunteers]
exten => _X.,1,NoOp(WebRTC call from volunteer ${CALLERID(num)})
 same => n,Stasis(llamenos)
 same => n,Hangup()
```

- [ ] **Step 4: Commit**

```bash
git add sip-bridge/asterisk-config/pjsip.conf sip-bridge/asterisk-config/http.conf sip-bridge/asterisk-config/extensions.conf
git commit -m "feat: add Asterisk WSS transport and volunteer dialplan for browser calling"
```

---

### Task 2: ARI Client — Add deleteDynamic Method

**Files:**
- Modify: `sip-bridge/src/ari-client.ts`
- Test: `sip-bridge/src/ari-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// sip-bridge/src/ari-client.test.ts
import { describe, expect, test, mock } from 'bun:test'

describe('AriClient.deleteDynamic', () => {
  test('sends DELETE to correct ARI path', async () => {
    // Mock fetch to capture the request
    const originalFetch = globalThis.fetch
    let capturedUrl = ''
    let capturedMethod = ''
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof url === 'string' ? url : url.toString()
      capturedMethod = init?.method ?? 'GET'
      return new Response(null, { status: 204 })
    }) as typeof fetch

    const { AriClient } = await import('./ari-client')
    const client = new AriClient({
      ariUrl: 'ws://localhost:8088/ari/events',
      ariRestUrl: 'http://localhost:8088/ari',
      ariUsername: 'test',
      ariPassword: 'test',
      workerWebhookUrl: 'http://localhost:3000',
      bridgeSecret: 'secret',
      bridgePort: 3000,
      bridgeBind: '127.0.0.1',
      stasisApp: 'llamenos',
    })

    await client.deleteDynamic('res_pjsip', 'endpoint', 'vol_abc123def456')
    expect(capturedUrl).toBe('http://localhost:8088/ari/asterisk/config/dynamic/res_pjsip/endpoint/vol_abc123def456')
    expect(capturedMethod).toBe('DELETE')

    globalThis.fetch = originalFetch
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sip-bridge && bun test src/ari-client.test.ts
```

Expected: FAIL with `client.deleteDynamic is not a function`

- [ ] **Step 3: Implement deleteDynamic**

Add to `sip-bridge/src/ari-client.ts` after the `reloadModule` method:

```typescript
/**
 * Delete a dynamic config object via ARI.
 * DELETE /ari/asterisk/config/dynamic/{configClass}/{objectType}/{id}
 * Used for deprovisioning SIP endpoints.
 */
async deleteDynamic(
  configClass: string,
  objectType: string,
  id: string,
): Promise<void> {
  await this.request('DELETE',
    `/asterisk/config/dynamic/${configClass}/${objectType}/${id}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd sip-bridge && bun test src/ari-client.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add sip-bridge/src/ari-client.ts sip-bridge/src/ari-client.test.ts
git commit -m "feat: add ARI deleteDynamic for SIP endpoint deprovisioning"
```

---

### Task 3: Bridge — Provision/Deprovision Endpoint Commands

**Files:**
- Modify: `sip-bridge/src/index.ts`
- Test: `sip-bridge/src/provision.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// sip-bridge/src/provision.test.ts
import { describe, expect, test, mock } from 'bun:test'

describe('Bridge /provision-endpoint', () => {
  test('provisions PJSIP auth, aor, and endpoint via ARI', async () => {
    // Track ARI calls
    const ariCalls: Array<{ method: string; configClass: string; objectType: string; id: string }> = []

    const mockAri = {
      configureDynamic: mock(async (configClass: string, objectType: string, id: string, _fields: Record<string, string>) => {
        ariCalls.push({ method: 'PUT', configClass, objectType, id })
      }),
    }

    // Import and call the provision handler directly
    // (We'll extract it into a testable function)
    const { provisionEndpoint } = await import('./endpoint-provisioner')
    const result = await provisionEndpoint(mockAri as any, 'abc123def456aabbccdd112233445566')

    expect(result.username).toBe('vol_abc123def456')
    expect(result.password).toBeTruthy()
    expect(result.password.length).toBeGreaterThanOrEqual(32)

    // Verify 3 ARI configureDynamic calls: auth, aor, endpoint
    expect(ariCalls).toHaveLength(3)
    expect(ariCalls[0]).toEqual({ method: 'PUT', configClass: 'res_pjsip', objectType: 'auth', id: 'vol_abc123def456' })
    expect(ariCalls[1]).toEqual({ method: 'PUT', configClass: 'res_pjsip', objectType: 'aor', id: 'vol_abc123def456' })
    expect(ariCalls[2]).toEqual({ method: 'PUT', configClass: 'res_pjsip', objectType: 'endpoint', id: 'vol_abc123def456' })
  })

  test('deprovisions in reverse order: endpoint, aor, auth', async () => {
    const ariCalls: Array<{ objectType: string; id: string }> = []
    const mockAri = {
      deleteDynamic: mock(async (_configClass: string, objectType: string, id: string) => {
        ariCalls.push({ objectType, id })
      }),
    }

    const { deprovisionEndpoint } = await import('./endpoint-provisioner')
    await deprovisionEndpoint(mockAri as any, 'abc123def456aabbccdd112233445566')

    expect(ariCalls).toHaveLength(3)
    expect(ariCalls[0].objectType).toBe('endpoint')
    expect(ariCalls[1].objectType).toBe('aor')
    expect(ariCalls[2].objectType).toBe('auth')
  })

  test('provision is idempotent — same username for same pubkey', async () => {
    const mockAri = { configureDynamic: mock(async () => {}) }
    const { provisionEndpoint } = await import('./endpoint-provisioner')

    const r1 = await provisionEndpoint(mockAri as any, 'abc123def456aabbccdd112233445566')
    const r2 = await provisionEndpoint(mockAri as any, 'abc123def456aabbccdd112233445566')

    expect(r1.username).toBe(r2.username)
    // Passwords may differ (CSPRNG)
  })
})
```

- [ ] **Step 2: Create endpoint-provisioner.ts**

```typescript
// sip-bridge/src/endpoint-provisioner.ts
import type { AriClient } from './ari-client'

/**
 * Provision a WebRTC-capable PJSIP endpoint for a volunteer.
 *
 * Creates three ARI dynamic config objects:
 * 1. auth — username/password credentials
 * 2. aor — address of record (max 1 contact, qualify for health)
 * 3. endpoint — WebRTC-enabled PJSIP endpoint
 *
 * Idempotent: ARI PUT overwrites existing objects with same ID.
 * Does NOT call reloadModule — with the memory sorcery wizard,
 * dynamic config changes take effect immediately.
 */
export async function provisionEndpoint(
  ari: Pick<AriClient, 'configureDynamic' | 'deleteDynamic'>,
  pubkey: string,
): Promise<{ username: string; password: string }> {
  const username = `vol_${pubkey.slice(0, 12)}`
  const password = generatePassword()

  // 1. Auth object — userpass credentials
  await ari.configureDynamic('res_pjsip', 'auth', username, {
    auth_type: 'userpass',
    username,
    password,
  })

  // 2. AOR — single contact, qualify every 30s for health
  try {
    await ari.configureDynamic('res_pjsip', 'aor', username, {
      max_contacts: '1',
      remove_existing: 'yes',
      qualify_frequency: '30',
    })
  } catch (err) {
    // Rollback auth on aor failure
    try { await ari.deleteDynamic('res_pjsip', 'auth', username) } catch { /* best effort */ }
    throw err
  }

  // 3. Endpoint — webrtc=yes auto-enables DTLS, ICE, AVPF
  try {
    await ari.configureDynamic('res_pjsip', 'endpoint', username, {
      auth: username,
      aors: username,
      webrtc: 'yes',
      transport: 'transport-wss',
      context: 'volunteers',
      dtls_auto_generate_cert: 'yes',
      media_encryption: 'dtls',
      disallow: 'all',
      allow: 'opus,ulaw',
    })
  } catch (err) {
    // Rollback auth + aor on endpoint failure
    try { await ari.deleteDynamic('res_pjsip', 'aor', username) } catch { /* best effort */ }
    try { await ari.deleteDynamic('res_pjsip', 'auth', username) } catch { /* best effort */ }
    throw err
  }

  return { username, password }
}

/**
 * Deprovision a volunteer's PJSIP endpoint.
 * Removes in reverse order: endpoint, aor, auth.
 * Errors are non-fatal (object may already be deleted).
 */
export async function deprovisionEndpoint(
  ari: Pick<AriClient, 'deleteDynamic'>,
  pubkey: string,
): Promise<void> {
  const username = `vol_${pubkey.slice(0, 12)}`

  try { await ari.deleteDynamic('res_pjsip', 'endpoint', username) } catch { /* may not exist */ }
  try { await ari.deleteDynamic('res_pjsip', 'aor', username) } catch { /* may not exist */ }
  try { await ari.deleteDynamic('res_pjsip', 'auth', username) } catch { /* may not exist */ }
}

/**
 * Check if a volunteer's endpoint exists.
 */
export async function checkEndpoint(
  ari: Pick<AriClient, 'request'>,
  pubkey: string,
): Promise<boolean> {
  const username = `vol_${pubkey.slice(0, 12)}`
  try {
    await (ari as any).request('GET', `/asterisk/config/dynamic/res_pjsip/endpoint/${username}`)
    return true
  } catch {
    return false
  }
}

/** Generate a 32-byte CSPRNG password as base64url */
function generatePassword(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
```

- [ ] **Step 3: Run test to verify it passes**

```bash
cd sip-bridge && bun test src/provision.test.ts
```

- [ ] **Step 4: Add HTTP routes to bridge index.ts**

In `sip-bridge/src/index.ts`, add these route handlers before the `return new Response('Not Found', { status: 404 })` line. Each uses the same HMAC signature verification pattern as existing routes:

```typescript
// Provision SIP endpoint for volunteer WebRTC
if (path === '/provision-endpoint' && method === 'POST') {
  const signature = request.headers.get('X-Bridge-Signature') ?? ''
  const body = await request.clone().text()

  if (config.bridgeSecret) {
    const isValid = await webhook.verifySignature(url.toString(), body, signature)
    if (!isValid) {
      return new Response('Forbidden', { status: 403 })
    }
  }

  try {
    const { pubkey } = JSON.parse(body) as { pubkey: string }
    const { provisionEndpoint } = await import('./endpoint-provisioner')
    const result = await provisionEndpoint(ari, pubkey)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

// Deprovision SIP endpoint
if (path === '/deprovision-endpoint' && method === 'POST') {
  const signature = request.headers.get('X-Bridge-Signature') ?? ''
  const body = await request.clone().text()

  if (config.bridgeSecret) {
    const isValid = await webhook.verifySignature(url.toString(), body, signature)
    if (!isValid) {
      return new Response('Forbidden', { status: 403 })
    }
  }

  try {
    const { pubkey } = JSON.parse(body) as { pubkey: string }
    const { deprovisionEndpoint } = await import('./endpoint-provisioner')
    await deprovisionEndpoint(ari, pubkey)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

// Check SIP endpoint exists
if (path === '/check-endpoint' && method === 'POST') {
  const signature = request.headers.get('X-Bridge-Signature') ?? ''
  const body = await request.clone().text()

  if (config.bridgeSecret) {
    const isValid = await webhook.verifySignature(url.toString(), body, signature)
    if (!isValid) {
      return new Response('Forbidden', { status: 403 })
    }
  }

  try {
    const { pubkey } = JSON.parse(body) as { pubkey: string }
    const { checkEndpoint } = await import('./endpoint-provisioner')
    const exists = await checkEndpoint(ari, pubkey)
    return Response.json({ ok: true, exists })
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
```

- [ ] **Step 5: Run all bridge tests**

```bash
cd sip-bridge && bun test
```

- [ ] **Step 6: Commit**

```bash
git add sip-bridge/src/endpoint-provisioner.ts sip-bridge/src/provision.test.ts sip-bridge/src/index.ts
git commit -m "feat: add SIP endpoint provision/deprovision bridge commands"
```

---

### Task 4: Server — BridgeClient, AsteriskProvisioner, Token Generation

**Files:**
- Create: `src/server/telephony/bridge-client.ts`
- Create: `src/server/telephony/sip-provisioner.ts`
- Create: `src/server/telephony/asterisk-provisioner.ts`
- Modify: `src/server/telephony/asterisk.ts`
- Modify: `src/server/telephony/webrtc-tokens.ts`
- Test: `src/server/telephony/asterisk-provisioner.test.ts`

- [ ] **Step 1: Extract BridgeClient from AsteriskAdapter**

The `bridgeRequest()` method is currently a private method on `AsteriskAdapter`. Extract it to a shared class since `AsteriskProvisioner` also needs it.

```typescript
// src/server/telephony/bridge-client.ts

/**
 * HMAC-authenticated HTTP client for the sip-bridge.
 * Shared by AsteriskAdapter (call management) and AsteriskProvisioner (endpoint lifecycle).
 *
 * All requests include X-Bridge-Signature (HMAC-SHA256) and X-Bridge-Timestamp
 * headers. The bridge verifies these before processing any command.
 */
export class BridgeClient {
  constructor(
    private bridgeCallbackUrl: string,
    private bridgeSecret: string,
  ) {}

  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.bridgeCallbackUrl}${path}`
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const bodyStr = body ? JSON.stringify(body) : ''
    const payload = `${timestamp}.${bodyStr}`

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.bridgeSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
    const signature = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Signature': signature,
        'X-Bridge-Timestamp': timestamp,
      },
      body: bodyStr || undefined,
    })

    if (!response.ok) {
      throw new Error(`Bridge request failed: ${response.status} ${response.statusText}`)
    }

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      return response.json()
    }
    return null
  }
}
```

- [ ] **Step 2: Update AsteriskAdapter to use BridgeClient**

In `src/server/telephony/asterisk.ts`:
- Import `BridgeClient`
- Replace the private `bridgeRequest()` method with a `BridgeClient` instance
- Constructor creates `this.bridge = new BridgeClient(bridgeCallbackUrl, bridgeSecret)`
- Replace all `this.bridgeRequest(...)` calls with `this.bridge.request(...)`

- [ ] **Step 3: Create SipEndpointProvisioner interface**

```typescript
// src/server/telephony/sip-provisioner.ts

/**
 * SipEndpointProvisioner — generic interface for provisioning WebRTC-capable
 * SIP endpoints on self-hosted PBX systems.
 *
 * Implementations:
 * - AsteriskProvisioner: provisions via sip-bridge → ARI dynamic config
 * - (Future) FreeSWITCHProvisioner: provisions via mod_xml_curl or ESL
 * - (Future) KamailioProvisioner: provisions via subscriber DB
 */
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
  provisionEndpoint(pubkey: string): Promise<SipEndpointConfig>
  deprovisionEndpoint(pubkey: string): Promise<void>
  checkEndpoint(pubkey: string): Promise<boolean>
}
```

- [ ] **Step 4: Implement AsteriskProvisioner**

```typescript
// src/server/telephony/asterisk-provisioner.ts
import { BridgeClient } from './bridge-client'
import type { SipEndpointConfig, SipEndpointProvisioner } from './sip-provisioner'

/**
 * AsteriskProvisioner — provisions WebRTC PJSIP endpoints via the sip-bridge.
 *
 * The bridge handles the actual ARI dynamic config calls. This class
 * constructs the SipEndpointConfig with WSS URI and ICE server config
 * from environment variables.
 */
export class AsteriskProvisioner implements SipEndpointProvisioner {
  private bridge: BridgeClient

  constructor(
    bridgeCallbackUrl: string,
    bridgeSecret: string,
    private asteriskDomain: string,
    private wssPort: number,
    private stunServer: string,
    private turnServer?: string,
    private turnSecret?: string,
  ) {
    this.bridge = new BridgeClient(bridgeCallbackUrl, bridgeSecret)
  }

  /** Compute time-limited TURN credential using HMAC-SHA1(secret, username) per RFC 5766 */
  private async computeTurnCredential(turnUsername: string): Promise<string> {
    if (!this.turnSecret) throw new Error('TURN_SECRET required for TURN credential generation')
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.turnSecret),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(turnUsername))
    // Base64-encode the HMAC (coturn expects base64, not hex)
    return btoa(String.fromCharCode(...new Uint8Array(sig)))
  }

  async provisionEndpoint(pubkey: string): Promise<SipEndpointConfig> {
    const result = await this.bridge.request('POST', '/provision-endpoint', { pubkey })
    const { username, password } = result as { ok: boolean; username: string; password: string }

    const iceServers: SipEndpointConfig['iceServers'] = []
    if (this.stunServer) {
      iceServers.push({ urls: this.stunServer })
    }
    if (this.turnServer && this.turnSecret) {
      // coturn uses use-auth-secret (RFC 5766 long-term credentials).
      // Credentials are time-limited: username = expiry:identity,
      // credential = HMAC-SHA1(secret, username)
      const ttl = 86400 // 24 hours
      const expiry = Math.floor(Date.now() / 1000) + ttl
      const turnUsername = `${expiry}:${username}`
      const turnCredential = await this.computeTurnCredential(turnUsername)
      iceServers.push({
        urls: this.turnServer,
        username: turnUsername,
        credential: turnCredential,
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
    await this.bridge.request('POST', '/deprovision-endpoint', { pubkey })
  }

  async checkEndpoint(pubkey: string): Promise<boolean> {
    try {
      const result = await this.bridge.request('POST', '/check-endpoint', { pubkey })
      return (result as { exists: boolean }).exists
    } catch {
      return false
    }
  }
}
```

- [ ] **Step 5: Write the test**

```typescript
// src/server/telephony/asterisk-provisioner.test.ts
import { describe, expect, test, mock } from 'bun:test'
import { AsteriskProvisioner } from './asterisk-provisioner'

// Mock fetch globally for bridge requests
const fetchCalls: Array<{ url: string; method: string; body: string }> = []
const originalFetch = globalThis.fetch
globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
  const urlStr = typeof url === 'string' ? url : url.toString()
  fetchCalls.push({
    url: urlStr,
    method: init?.method ?? 'GET',
    body: init?.body as string ?? '',
  })
  return new Response(JSON.stringify({ ok: true, username: 'vol_abc123def456', password: 'test-pass-123' }), {
    headers: { 'content-type': 'application/json' },
  })
}) as typeof fetch

describe('AsteriskProvisioner', () => {
  const provisioner = new AsteriskProvisioner(
    'http://bridge:3000',
    'test-secret',
    'asterisk.example.com',
    8089,
    'stun:stun.l.google.com:19302',
    'turn:turn.example.com:3478',
    'test-turn-secret-abc123',
  )

  test('provisionEndpoint returns SipEndpointConfig', async () => {
    fetchCalls.length = 0
    const config = await provisioner.provisionEndpoint('abc123def456aabbcc')

    expect(config.sipUri).toBe('sip:vol_abc123def456@asterisk.example.com')
    expect(config.wsUri).toBe('wss://asterisk.example.com:8089/ws')
    expect(config.username).toBe('vol_abc123def456')
    expect(config.password).toBe('test-pass-123')
    expect(config.iceServers).toHaveLength(2)
    expect(config.iceServers[0]).toEqual({ urls: 'stun:stun.l.google.com:19302' })
    // TURN credentials are time-limited HMAC — verify format
    expect(config.iceServers[1].urls).toBe('turn:turn.example.com:3478')
    expect(config.iceServers[1].username).toMatch(/^\d+:vol_/) // timestamp:identity
    expect(config.iceServers[1].credential).toBeTruthy() // HMAC-SHA1 base64

    // Verify bridge was called
    expect(fetchCalls[0].url).toContain('/provision-endpoint')
  })

  test('deprovisionEndpoint calls bridge', async () => {
    fetchCalls.length = 0
    await provisioner.deprovisionEndpoint('abc123def456aabbcc')
    expect(fetchCalls[0].url).toContain('/deprovision-endpoint')
  })
})
```

- [ ] **Step 6: Run tests**

```bash
bun test src/server/telephony/asterisk-provisioner.test.ts
```

- [ ] **Step 7: Update AsteriskConfigSchema with new fields**

In `src/shared/schemas/providers.ts`, extend `AsteriskConfigSchema`:

```typescript
export const AsteriskConfigSchema = BaseProviderSchema.extend({
  type: z.literal('asterisk'),
  ariUrl: z.string().url('Must be a valid URL'),
  ariUsername: z.string().min(1),
  ariPassword: z.string().min(1),
  bridgeCallbackUrl: z.string().url().optional(),
  bridgeSecret: z.string().optional(),
  // SIP WebRTC browser calling fields
  asteriskDomain: z.string().optional(),
  wssPort: z.number().optional(),
  stunServer: z.string().optional(),
  turnServer: z.string().optional(),
  turnSecret: z.string().optional(),
})
```

Run `bun run typecheck` to verify no downstream type errors.

- [ ] **Step 8: Update webrtc-tokens.ts — replace Asterisk throw**

In `src/server/telephony/webrtc-tokens.ts`:

Replace the `case 'asterisk':` block with:

```typescript
case 'asterisk': {
  // Lazy import to avoid circular dependency
  const { AsteriskProvisioner } = await import('./asterisk-provisioner')
  const provisioner = new AsteriskProvisioner(
    config.bridgeCallbackUrl!,
    config.bridgeSecret!,
    config.asteriskDomain ?? 'localhost',
    config.wssPort ?? 8089,
    config.stunServer ?? 'stun:stun.l.google.com:19302',
    config.turnServer,
    config.turnSecret,
  )
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

Also update `isWebRtcConfigured`:

```typescript
case 'asterisk':
  return !!(config.ariUrl && config.bridgeCallbackUrl)
```

- [ ] **Step 9: Run typecheck + build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 10: Commit**

```bash
git add src/server/telephony/bridge-client.ts src/server/telephony/sip-provisioner.ts src/server/telephony/asterisk-provisioner.ts src/server/telephony/asterisk-provisioner.test.ts src/server/telephony/asterisk.ts src/server/telephony/webrtc-tokens.ts src/shared/schemas/providers.ts
git commit -m "feat: add SipEndpointProvisioner + AsteriskProvisioner + BridgeClient"
```

---

### Task 5: Client — SipWebRTCAdapter (JsSIP)

**Files:**
- Create: `src/client/lib/webrtc/adapters/sip.ts`
- Test: `src/client/lib/webrtc/adapters/sip.test.ts`

**Prerequisite:** `WebRTCAdapter` interface from browser calling plan must exist at `src/client/lib/webrtc/types.ts`. If not yet implemented, create the types file first per the browser calling plan Task 1.

- [ ] **Step 1: Install JsSIP**

```bash
bun add jssip
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/client/lib/webrtc/adapters/sip.test.ts
import { describe, expect, test, mock } from 'bun:test'

// Mock JsSIP module
const mockSession = {
  answer: mock(() => {}),
  terminate: mock(() => {}),
  mute: mock(() => {}),
  unmute: mock(() => {}),
  isMuted: mock(() => ({ audio: false, video: false })),
  remote_identity: { uri: { user: 'caller123' } },
  on: mock((_event: string, _handler: Function) => {}),
}

const mockUA = {
  start: mock(() => {}),
  stop: mock(() => {}),
  on: mock((_event: string, _handler: Function) => {}),
}

mock.module('jssip', () => ({
  default: {
    WebSocketInterface: mock(() => ({})),
    UA: mock(() => mockUA),
  },
}))

describe('SipWebRTCAdapter', () => {
  test('implements WebRTCAdapter interface', async () => {
    const { SipWebRTCAdapter } = await import('./sip')
    const adapter = new SipWebRTCAdapter()
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

- [ ] **Step 3: Implement SipWebRTCAdapter**

Create `src/client/lib/webrtc/adapters/sip.ts` with the full implementation from the spec. Key implementation details:

- Dynamic `import('jssip')` to avoid bundling for non-SIP users
- Token is base64 JSON: `{ wsUri, sipUri, password, iceServers }`
- `ua.on('disconnected')` emits error for network loss detection
- `newRTCSession` with `originator === 'remote'` only
- Defensive busy rejection if `#session` already exists
- One-shot Promise for initial registration with `settled` flag
- `user_agent: 'Hotline/1.0'` — generic, no app name leak

See spec section "Client-Side: SipWebRTCAdapter" for the complete implementation.

- [ ] **Step 4: Run tests**

```bash
bun test src/client/lib/webrtc/adapters/sip.test.ts
```

- [ ] **Step 5: Run typecheck + build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/webrtc/adapters/sip.ts src/client/lib/webrtc/adapters/sip.test.ts
git commit -m "feat: SipWebRTCAdapter using JsSIP for browser SIP/WebRTC calling"
```

---

### Task 6: WebRTCManager Factory Integration

**Files:**
- Modify: `src/client/lib/webrtc/manager.ts` (or `src/client/lib/webrtc.ts` if manager not yet created)

**Prerequisite:** Browser calling plan must be at least partially implemented — `createAdapter()` factory must exist. If not, this step adds the SIP case to whatever adapter selection exists.

- [ ] **Step 1: Add SIP cases to createAdapter**

In the adapter factory function, add:

```typescript
import { SipWebRTCAdapter } from './adapters/sip'

// In createAdapter():
case 'asterisk':
case 'freeswitch':
case 'kamailio':
case 'sip':
  return new SipWebRTCAdapter()
```

- [ ] **Step 2: Run typecheck + build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/webrtc/manager.ts
git commit -m "feat: add SIP adapter cases to WebRTCManager factory"
```

---

### Task 7: Bridge — Extend Ring Command for Browser Endpoints

**Files:**
- Modify: `sip-bridge/src/index.ts` (the `/ring` route)

- [ ] **Step 1: Update the ring volunteer type and origination logic**

In the `/ring` handler, the current volunteer type is `{ pubkey: string; phone: string }`. Extend it to accept optional `browserIdentity`:

```typescript
const data = JSON.parse(body) as {
  callSid: string
  callerNumber: string
  volunteers: Array<{ pubkey: string; phone?: string; browserIdentity?: string }>
  callbackUrl: string
}

const channelIds: string[] = []

for (const vol of data.volunteers) {
  // Ring phone leg (existing behavior)
  if (vol.phone) {
    const endpoint = `PJSIP/${vol.phone}@trunk`
    try {
      const channel = await ari.originate({
        endpoint,
        callerId: data.callerNumber,
        timeout: 30,
        app: config.stasisApp,
        appArgs: `dialed,${data.callSid},${vol.pubkey},phone`,
      })
      channelIds.push(channel.id)
      // ... existing ringing state tracking
    } catch (err) {
      console.error(`[bridge] Failed to ring ${vol.pubkey} (phone):`, err)
    }
  }

  // Ring browser leg (new — PJSIP endpoint provisioned via /provision-endpoint)
  if (vol.browserIdentity) {
    const endpoint = `PJSIP/${vol.browserIdentity}`
    try {
      const channel = await ari.originate({
        endpoint,
        callerId: data.callerNumber,
        timeout: 30,
        app: config.stasisApp,
        appArgs: `dialed,${data.callSid},${vol.pubkey},browser`,
      })
      channelIds.push(channel.id)

      const parentCall = handler['calls'].get(data.callSid)
      if (parentCall) {
        parentCall.ringingChannels.push(channel.id)
      }
      handler['ringingMap'].set(channel.id, data.callSid)
    } catch (err) {
      console.error(`[bridge] Failed to ring ${vol.pubkey} (browser):`, err)
    }
  }
}
```

- [ ] **Step 2: Update AsteriskAdapter.ringVolunteers() to include browser identity**

In `src/server/telephony/asterisk.ts`, update the `ringVolunteers` method:

```typescript
async ringVolunteers(params: RingVolunteersParams): Promise<string[]> {
  const { callSid, callerNumber, volunteers, callbackUrl, hubId } = params
  const result = await this.bridge.request('POST', '/ring', {
    parentCallSid: callSid,
    callerNumber,
    volunteers: volunteers.map((v) => ({
      pubkey: v.pubkey,
      phone: v.phone,
      browserIdentity: v.browserIdentity,
    })),
    callbackUrl,
    hubId,
  })
  return (result as { channelIds?: string[] })?.channelIds ?? []
}
```

**Note:** This requires the `RingVolunteersParams` volunteer type to have optional `browserIdentity`. This change is part of the browser calling plan (Task 6-7). If not yet implemented, the type in `src/server/telephony/adapter.ts` needs updating:

```typescript
export interface RingVolunteersParams {
  callSid: string
  callerNumber: string
  volunteers: Array<{ pubkey: string; phone?: string; browserIdentity?: string }>
  callbackUrl: string
  hubId?: string
}
```

- [ ] **Step 3: Run typecheck + build**

```bash
bun run typecheck && bun run build
```

- [ ] **Step 4: Commit**

```bash
git add sip-bridge/src/index.ts src/server/telephony/asterisk.ts src/server/telephony/adapter.ts
git commit -m "feat: extend ring command to support browser PJSIP endpoints"
```

---

### Task 8: Docker Compose — coturn + Asterisk WSS

**Files:**
- Modify: `deploy/ansible/templates/docker-compose.j2`
- Modify: `docker-compose.dev.yml` (if it exists, otherwise note it)

- [ ] **Step 1: Add coturn service to docker-compose.j2**

Add inside the `{% if 'asterisk' in compose_profiles %}` block, after `sip-bridge`:

```yaml
  # ── coturn TURN/STUN server ──────────────────────────────────
  # Required for WebRTC NAT traversal. Volunteers behind NAT use
  # TURN relay for media when direct peer-to-peer fails.
  coturn:
    image: {{ coturn_image | default('coturn/coturn:4.6') }}
    restart: unless-stopped
    ports:
      - "3478:3478"       # STUN/TURN UDP
      - "3478:3478/tcp"   # STUN/TURN TCP
      - "5349:5349"       # STUN/TURN TLS
      - "5349:5349/tcp"   # STUN/TURN TLS TCP
      - "49152-49252:49152-49252/udp"  # TURN relay ports
    environment:
      - TURN_REALM={{ domain }}
      - TURN_SECRET={{ turn_secret }}
    volumes:
      - ./turnserver.conf:/etc/turnserver.conf:ro
{% if coturn_cert_path is defined %}
      - {{ coturn_cert_path }}:/etc/ssl/turn/cert.pem:ro
      - {{ coturn_key_path }}:/etc/ssl/turn/key.pem:ro
{% endif %}
    networks:
      - web
      - internal
    security_opt:
      - no-new-privileges:true
```

- [ ] **Step 2: Expose Asterisk WSS port**

Update the `asterisk` service in docker-compose.j2 to expose WSS port to the `web` network (so Caddy can proxy):

```yaml
  asterisk:
    image: {{ asterisk_image }}
    restart: unless-stopped
    volumes:
      - asterisk-config:/etc/asterisk
    networks:
      - internal
      - web         # NEW — needed for Caddy WSS proxy
    healthcheck:
      test: ["CMD", "asterisk", "-rx", "core show version"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    security_opt:
      - no-new-privileges:true
```

- [ ] **Step 3: Add coturn-data volume**

In the `volumes:` section, inside the asterisk profile conditional:

```yaml
{% if 'asterisk' in compose_profiles %}
  asterisk-config:
  coturn-data:
{% endif %}
```

- [ ] **Step 4: Add equivalent services to docker-compose.dev.yml**

The dev compose is at `deploy/docker/docker-compose.dev.yml`. Host port 8089 is already mapped to ARI (container port 8088). Use host port **8090** for WSS (container port 8089):

```yaml
  asterisk:
    # ... existing config ...
    ports:
      - "8089:8088"     # ARI HTTP/WS (existing)
      - "8090:8089"     # WSS for browser SIP clients (new)

  coturn:
    image: coturn/coturn:4.6
    restart: unless-stopped
    ports:
      - "3478:3478"
      - "3478:3478/tcp"
    environment:
      - TURN_REALM=localhost
      - TURN_SECRET=dev-turn-secret-changeme
    command: >
      turnserver
      --realm=localhost
      --use-auth-secret
      --static-auth-secret=dev-turn-secret-changeme
      --listening-port=3478
      --min-port=49152
      --max-port=49172
      --no-cli
      --fingerprint
      --log-file=stdout
    networks:
      - internal
```

Also mount dev TLS certs into Asterisk container (generated by `scripts/dev-certs.sh`):

```yaml
  asterisk:
    volumes:
      - ./sip-bridge/dev-certs/asterisk.pem:/etc/asterisk/keys/asterisk.pem:ro
      - ./sip-bridge/dev-certs/asterisk.key:/etc/asterisk/keys/asterisk.key:ro
```

Update CLAUDE.md port offset comment: `v1: asterisk-ari:8089, asterisk-wss:8090`

- [ ] **Step 5: Commit**

```bash
git add deploy/ansible/templates/docker-compose.j2
git commit -m "feat: add coturn TURN server and Asterisk WSS to Docker Compose"
```

---

### Task 9: Caddy — WSS Proxy Route

**Files:**
- Modify: `deploy/ansible/templates/caddy.j2`

- [ ] **Step 1: Add WSS proxy route for Asterisk SIP signaling**

Add before the `# Everything else` catch-all handler:

```
{% if 'asterisk' in compose_profiles %}
	# WebSocket Secure proxy for SIP signaling (JsSIP → Asterisk PJSIP)
	# Caddy terminates TLS; proxies plain WS to Asterisk's HTTP server.
	# Path: /ws → asterisk:8088/ws (Asterisk's built-in WS endpoint)
	handle /ws {
		reverse_proxy asterisk:8088
	}
{% endif %}
```

**Note:** With Caddy terminating TLS, Asterisk does NOT need its own TLS config in production. The `http.conf` TLS settings are only for local dev (direct browser-to-Asterisk). In production, the flow is: `Browser WSS → Caddy (TLS) → Asterisk WS (plain)`.

- [ ] **Step 2: Update CSP to allow WSS connection to /ws**

Update the Content-Security-Policy `connect-src` directive to include the WSS endpoint:

```
Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' wss://{{ domain }}/nostr wss://{{ domain }}/ws; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
```

The addition is `wss://{{ domain }}/ws` in the `connect-src` list.

- [ ] **Step 3: Open TURN ports in firewall**

In `deploy/ansible/demo_vars.example.yml` and `vars.example.yml`, add TURN ports to `firewall_extra_ports`:

```yaml
# When asterisk profile is enabled, these ports are needed for TURN relay
firewall_extra_ports:
  - "3478/tcp"    # STUN/TURN
  - "3478/udp"    # STUN/TURN
  - "5349/tcp"    # STUN/TURN TLS
  - "5349/udp"    # STUN/TURN TLS
  - "49152-49252/udp"  # TURN relay range
```

- [ ] **Step 4: Commit**

```bash
git add deploy/ansible/templates/caddy.j2
git commit -m "feat: add Caddy WSS proxy route and CSP for SIP browser calling"
```

---

### Task 10: Ansible Env Vars & Config Templates

**Files:**
- Modify: `deploy/ansible/templates/env.j2`
- Modify: `deploy/ansible/demo_vars.example.yml`
- Modify: `deploy/ansible/vars.example.yml` (if exists)
- Create: `deploy/ansible/templates/turnserver.conf.j2`

- [ ] **Step 1: Add SIP WebRTC env vars to env.j2**

Append to the `{% if 'asterisk' in compose_profiles %}` block in `deploy/ansible/templates/env.j2`:

```
# SIP WebRTC browser calling
ASTERISK_DOMAIN={{ asterisk_domain | default(domain) }}
ASTERISK_WSS_PORT={{ asterisk_wss_port | default(443) }}
STUN_SERVER={{ stun_server | default('stun:' + domain + ':3478') }}
TURN_SERVER={{ turn_server | default('turn:' + domain + ':3478') }}
TURN_SECRET={{ turn_secret }}
```

**Note on `ASTERISK_WSS_PORT`:** In production with Caddy proxy, the WSS port from the browser's perspective is 443 (standard HTTPS). The `wsUri` becomes `wss://domain.com/ws`. The port 8089 is internal only.

- [ ] **Step 2: Add vars to demo_vars.example.yml**

Append to the Asterisk section:

```yaml
# ─── Asterisk WebRTC (when asterisk profile enabled) ──────────
# Domain for SIP URI and WSS connections (defaults to main domain)
# asterisk_domain: demo.llamenos-hotline.com

# coturn TURN server shared secret (generate with: openssl rand -hex 32)
# Used for TURN credential generation. Required for WebRTC NAT traversal.
turn_secret: ""

# STUN/TURN server addresses (default: self-hosted coturn on same domain)
# stun_server: "stun:demo.llamenos-hotline.com:3478"
# turn_server: "turn:demo.llamenos-hotline.com:3478"

# coturn Docker image
coturn_image: coturn/coturn:4.6
```

- [ ] **Step 3: Create turnserver.conf template**

```ini
# coturn configuration — managed by Ansible
# Minimal config for WebRTC TURN relay

# Realm — must match the domain
realm={{ domain }}

# Use long-term credential mechanism with shared secret
use-auth-secret
static-auth-secret={{ turn_secret }}

# Listening ports
listening-port=3478
tls-listening-port=5349

# Relay port range (keep small for Docker port mapping)
min-port=49152
max-port=49252

# Disable CLI
no-cli

# Fingerprint (for TURN over TCP)
fingerprint

# Log to stdout for Docker
log-file=stdout

# Only relay — no TURN-to-TURN
no-multicast-peers

{% if coturn_cert_path is defined %}
# TLS certificates
cert=/etc/ssl/turn/cert.pem
pkey=/etc/ssl/turn/key.pem
{% endif %}
```

- [ ] **Step 4: Template the turnserver.conf in the deploy role**

In `deploy/ansible/roles/llamenos/tasks/main.yml` (or wherever templates are applied), add:

```yaml
- name: Template turnserver.conf
  ansible.builtin.template:
    src: turnserver.conf.j2
    dest: "{{ app_dir }}/turnserver.conf"
    mode: "0640"
  when: "'asterisk' in compose_profiles"
```

- [ ] **Step 5: Commit**

```bash
git add deploy/ansible/templates/env.j2 deploy/ansible/templates/turnserver.conf.j2 deploy/ansible/demo_vars.example.yml
git commit -m "feat: add coturn, STUN/TURN, and WSS env vars to Ansible config"
```

---

### Task 11: Local Dev TLS Certificates

**Files:**
- Create: `scripts/dev-certs.sh`

- [ ] **Step 1: Create dev cert generation script**

```bash
#!/usr/bin/env bash
# Generate locally-trusted TLS certificates for dev Asterisk WSS.
# Requires mkcert: https://github.com/FiloSottile/mkcert
#
# Usage: ./scripts/dev-certs.sh
#
# Generates certs in sip-bridge/dev-certs/ for:
# - Asterisk WSS (localhost, 127.0.0.1)

set -euo pipefail

CERT_DIR="sip-bridge/dev-certs"

if ! command -v mkcert &>/dev/null; then
  echo "Error: mkcert is not installed."
  echo "Install it: https://github.com/FiloSottile/mkcert#installation"
  exit 1
fi

# Install local CA if not already done
mkcert -install 2>/dev/null || true

mkdir -p "$CERT_DIR"

echo "Generating TLS certificates for local Asterisk WSS..."
mkcert -cert-file "$CERT_DIR/asterisk.pem" \
       -key-file "$CERT_DIR/asterisk.key" \
       localhost 127.0.0.1 ::1

echo "Certificates generated:"
echo "  $CERT_DIR/asterisk.pem"
echo "  $CERT_DIR/asterisk.key"
echo ""
echo "Mount into Asterisk container at /etc/asterisk/keys/"
```

- [ ] **Step 2: Add dev-certs to .gitignore**

Append to `.gitignore`:

```
sip-bridge/dev-certs/
```

- [ ] **Step 3: Commit**

```bash
chmod +x scripts/dev-certs.sh
git add scripts/dev-certs.sh .gitignore
git commit -m "feat: add dev TLS cert generation script for Asterisk WSS"
```

---

### Task 12: E2E Tests — SIP Browser Calling Against Local Asterisk

**Files:**
- Create: `tests/api/sip-webrtc.spec.ts`

**Prerequisite:** `bun run dev:docker` must be running with Asterisk container. Dev TLS certs generated via `scripts/dev-certs.sh`.

- [ ] **Step 1: Write API integration tests**

```typescript
// tests/api/sip-webrtc.spec.ts
import { test, expect } from '@playwright/test'
import { authedRequest } from '../helpers/authed-request'

test.describe('SIP WebRTC Token Generation', () => {
  test('GET /api/telephony/webrtc-token returns SIP credentials for Asterisk provider', async () => {
    // This test requires a hub configured with Asterisk provider
    // and dev:docker running with Asterisk container
    const response = await authedRequest('GET', '/api/telephony/webrtc-token')

    // If Asterisk is not the configured provider, this may return a different provider
    // Only assert SIP-specific fields if provider is asterisk
    if (response.provider === 'asterisk') {
      expect(response.token).toBeTruthy()
      expect(response.ttl).toBe(600)

      // Decode token — should be base64 JSON
      const decoded = JSON.parse(atob(response.token))
      expect(decoded.wsUri).toContain('wss://')
      expect(decoded.sipUri).toContain('sip:vol_')
      expect(decoded.password).toBeTruthy()
      expect(decoded.iceServers).toBeInstanceOf(Array)
    }
  })
})
```

- [ ] **Step 2: Write E2E browser SIP test**

```typescript
// tests/ui/sip-browser-calling.spec.ts
import { test, expect } from '@playwright/test'

test.describe('SIP Browser Calling', () => {
  // This test requires:
  // 1. bun run dev:docker (Asterisk + coturn running)
  // 2. scripts/dev-certs.sh (TLS certs generated)
  // 3. Hub configured with Asterisk provider

  test.skip(
    !process.env.TEST_SIP_WEBRTC,
    'Set TEST_SIP_WEBRTC=1 to run SIP E2E tests (requires Asterisk container)'
  )

  test('SipWebRTCAdapter registers and receives incoming call', async ({ page }) => {
    // 1. Navigate to dashboard (authenticated)
    await page.goto('/dashboard')

    // 2. Verify JsSIP UA registered via WebRTC state
    await page.waitForFunction(() => {
      // Check that WebRTCManager reached 'ready' state
      return (window as any).__webrtcState === 'ready'
    }, { timeout: 15000 })

    // 3. Originate a test call via bridge ARI
    const bridgeUrl = process.env.BRIDGE_URL ?? 'http://localhost:3000'
    const response = await fetch(`${bridgeUrl}/status`)
    expect(response.ok).toBe(true)

    // 4. Verify RTCPeerConnection state after answering
    // (Full E2E test with call origination to be expanded
    //  when the ring command integration is complete)
  })
})
```

- [ ] **Step 3: Commit**

```bash
git add tests/api/sip-webrtc.spec.ts tests/ui/sip-browser-calling.spec.ts
git commit -m "test: add SIP WebRTC API and E2E tests"
```

---

### Task 13: Update Browser Calling Plan (Coordination)

**Files:**
- Modify: `docs/superpowers/plans/2026-03-24-browser-calling.md`

- [ ] **Step 1: Remove Asterisk from "ignore browserIdentity" list**

The browser calling plan says Asterisk should "ignore `browserIdentity` for now." This spec adds browser leg support for Asterisk. Update the plan to include Asterisk as a browser-leg-aware adapter.

- [ ] **Step 2: Standardize browserIdentity length to 12 hex chars**

The plan uses `pubkey.slice(0, 16)` for `browserIdentity` in `ringing.ts`. This spec uses `pubkey.slice(0, 12)` for PJSIP endpoint names. Update to 12 everywhere.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-03-24-browser-calling.md
git commit -m "docs: update browser calling plan for Asterisk SIP WebRTC integration"
```

---

### Task 14: Update Existing Documentation

**Files:**
- Modify: `CLAUDE.md` (add SIP WebRTC to gotchas and key patterns)
- Modify: `docs/NEXT_BACKLOG.md` (track this work)

- [ ] **Step 1: Add SIP WebRTC to CLAUDE.md Key Technical Patterns**

Add to the Key Technical Patterns section:

```markdown
- **SIP WebRTC (JsSIP)**: Browser calling for self-hosted SIP providers (Asterisk, FreeSWITCH, Kamailio). `SipWebRTCAdapter` wraps JsSIP UA for SIP-over-WSS signaling + browser DTLS-SRTP media. Endpoints provisioned via `AsteriskProvisioner` → sip-bridge → ARI dynamic config. coturn provides TURN relay for NAT traversal. Caddy terminates TLS and proxies WSS to Asterisk.
```

Add to Gotchas section:

```markdown
- JsSIP `reloadModule('res_pjsip.so')` disrupts ALL active SIP sessions — avoid during live calls; memory sorcery wizard makes dynamic config effective immediately
- Asterisk WSS requires TLS — in production Caddy proxies WSS→WS; for local dev use `scripts/dev-certs.sh` (mkcert)
- coturn TURN credentials use time-limited HMAC from shared secret — not static username/password
- JsSIP `newRTCSession` fires for both incoming and outgoing — check `originator === 'remote'`
```

- [ ] **Step 2: Update NEXT_BACKLOG.md**

Add this feature to the appropriate section.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/NEXT_BACKLOG.md
git commit -m "docs: add SIP WebRTC browser calling to project documentation"
```

---

### Task 15: Final Integration Verification

- [ ] **Step 1: Run full typecheck**

```bash
bun run typecheck
```

- [ ] **Step 2: Run full build**

```bash
bun run build
```

- [ ] **Step 3: Run all unit tests**

```bash
bun run test:unit
```

- [ ] **Step 4: Run API tests**

```bash
bun run test:api
```

- [ ] **Step 5: Verify Ansible templates render correctly**

```bash
cd deploy/ansible && just validate
```

Or if no `validate` target, do a dry run:

```bash
cd deploy/ansible && ansible-playbook playbooks/deploy-demo.yml --check --diff
```

- [ ] **Step 6: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: address integration issues from final verification"
```
