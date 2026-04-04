# Epic 49: Asterisk Bridge Auto-Configuration

## Problem

The `sip-bridge` service connects Asterisk ARI to the CF Worker via webhooks, but it does not configure the Asterisk PJSIP SIP trunk at startup. Operators must manually edit `sip-bridge/asterisk-config/pjsip.conf` with `YOUR_SIP_USERNAME`, `YOUR_SIP_PASSWORD`, `YOUR_SIP_PROVIDER`, and `YOUR_SIP_PROVIDER_IP` placeholder values before the trunk will register with the upstream SIP provider. This manual step is error-prone, blocks automated deployments, and requires operators to understand Asterisk configuration syntax.

The static `pjsip.conf` also means changing SIP credentials requires editing a config file inside the Docker image's bind-mounted volume — an operation that is easy to miss or get wrong during redeployment, and that cannot be driven from environment variables alone.

## Solution

When `sip-bridge` starts and SIP credentials are present in the environment (`SIP_PROVIDER`, `SIP_USERNAME`, `SIP_PASSWORD`), it automatically configures the PJSIP trunk via Asterisk's ARI dynamic configuration REST API, then reloads the `res_pjsip` module. The operation is idempotent — safe to run on every restart because ARI's `PUT` config API creates-or-replaces config objects. On failure, the bridge logs an error and continues; Asterisk may already be correctly configured from a previous run or from static config.

The static `pjsip.conf` is simplified to contain only transport-level stanzas (`transport-udp`, `transport-tcp`), which are infrastructure that does not change per-deployment. All trunk, auth, AOR, and registration objects are managed dynamically.

## Architecture

```
                      ┌──────────────────────────────┐
                      │      docker internal net      │
                      │                              │
  ┌─────────────┐     │   ┌─────────────────────┐   │
  │  SIP        │◄────┼───│  asterisk           │   │
  │  Provider   │     │   │  :5060 (SIP/UDP)    │   │
  └─────────────┘     │   │  :8088 (HTTP/ARI)   │   │
                      │   └──────────┬──────────┘   │
                      │              │ ARI REST +    │
                      │              │ WebSocket     │
                      │   ┌──────────▼──────────┐   │
                      │   │  sip-bridge    │   │
                      │   │  (Bun service)      │   │
                      │   │                     │   │
                      │   │  ① startup:         │   │
                      │   │   loadConfig()      │   │
                      │   │   ari.connect()     │   │
                      │   │   pjsip.configure() │   │
                      │   │    → PUT /config    │   │
                      │   │    → PUT /modules   │   │
                      │   └──────────┬──────────┘   │
                      │              │ webhooks      │
                      │   ┌──────────▼──────────┐   │
                      │   │  app (Worker/Bun)   │   │
                      │   │  :3000              │   │
                      │   └─────────────────────┘   │
                      └──────────────────────────────┘
```

### ARI Dynamic Configuration API

Asterisk exposes PJSIP configuration objects via REST:

```
PUT /ari/asterisk/config/dynamic/{configClass}/{objectType}/{id}
Body: { "fields": [{ "attribute": "key", "value": "val" }, ...] }
```

Four objects are configured:

| Object | configClass | objectType | id |
|--------|------------|------------|----|
| Auth | `res_pjsip` | `auth` | `trunk-auth` |
| AOR | `res_pjsip` | `aor` | `trunk` |
| Endpoint | `res_pjsip` | `endpoint` | `trunk` |
| Registration | `res_pjsip` | `registration` | `trunk-reg` |

After all four objects are written, the module is reloaded:

```
PUT /ari/asterisk/modules/res_pjsip.so
```

## Implementation

### New file: `sip-bridge/src/pjsip-configurator.ts`

`PjsipConfigurator` class. Takes `AriClient` in its constructor. Single public method:

```typescript
async configure(provider: string, username: string, password: string): Promise<void>
```

Steps:
1. Configure `res_pjsip/auth/trunk-auth` — `auth_type=userpass`, `username`, `password`
2. Configure `res_pjsip/aor/trunk` — `contact=sip:{username}@{provider}`, `qualify_frequency=60`
3. Configure `res_pjsip/endpoint/trunk` — `transport=transport-udp`, `context=from-trunk`, `disallow=all`, `allow=ulaw,alaw`, `outbound_auth=trunk-auth`, `aors=trunk`
4. Configure `res_pjsip/registration/trunk-reg` — `transport=transport-udp`, `outbound_auth=trunk-auth`, `server_uri=sip:{provider}`, `client_uri=sip:{username}@{provider}`, `retry_interval=60`, `forbidden_retry_interval=600`, `expiration=3600`
5. Reload `res_pjsip.so`

Each step logs `[pjsip] Configuring {objectType}/{id}...` and `[pjsip] Reloading res_pjsip.so...`. Throws on any HTTP error (4xx/5xx from ARI).

### Modified: `sip-bridge/src/ari-client.ts`

Add two public methods that delegate to the existing `private request<T>()`:

```typescript
async configureDynamic(
  configClass: string,
  objectType: string,
  id: string,
  fields: Record<string, string>
): Promise<void>

async reloadModule(moduleName: string): Promise<void>
```

`configureDynamic` calls `PUT /asterisk/config/dynamic/{configClass}/{objectType}/{id}` with body `{ fields: Object.entries(fields).map(([attribute, value]) => ({ attribute, value })) }`.

`reloadModule` calls `PUT /asterisk/modules/{moduleName}` with no body.

### Modified: `sip-bridge/src/types.ts`

Add optional SIP fields to `BridgeConfig`:

```typescript
/** SIP provider hostname or IP for PJSIP trunk auto-config */
sipProvider?: string
/** SIP username for PJSIP trunk registration */
sipUsername?: string
/** SIP password for PJSIP trunk registration */
sipPassword?: string
```

### Modified: `sip-bridge/src/index.ts`

In `loadConfig()`: read `SIP_PROVIDER`, `SIP_USERNAME`, `SIP_PASSWORD` as optional (no error if absent).

In `main()`, after `ari.connect()` succeeds: check if all three SIP credentials are present. If so, instantiate `PjsipConfigurator` and call `configure()`. Wrap in try/catch — log the error and continue on failure. Example:

```typescript
if (config.sipProvider && config.sipUsername && config.sipPassword) {
  const pjsip = new PjsipConfigurator(ari)
  try {
    await pjsip.configure(config.sipProvider, config.sipUsername, config.sipPassword)
    console.log('[bridge] PJSIP trunk configured successfully')
  } catch (err) {
    console.error('[bridge] PJSIP auto-config failed (continuing):', err)
  }
}
```

Also expose a `sipConfigured` field in the `/health` response so tests can verify the bridge attempted (or skipped) auto-config. The health response shape gains:

```typescript
sipConfigured: boolean   // true if configure() completed without throwing
sipConfigSkipped: boolean  // true if SIP env vars were absent
```

### Modified: `sip-bridge/asterisk-config/pjsip.conf`

Remove all `[trunk]`, `[trunk-auth]`, `[trunk-reg]`, and provider-specific stanzas. Keep only:

```ini
; Transport stanzas — static infrastructure, managed by config file.
; Trunk/auth/aor/registration are managed dynamically by sip-bridge
; at startup via the ARI dynamic config API.

[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0

[transport-tcp]
type=transport
protocol=tcp
bind=0.0.0.0
```

### Modified: `deploy/docker/docker-compose.yml`

Add to `sip-bridge` environment:

```yaml
- ARI_REST_URL=http://asterisk:8088/ari
- SIP_PROVIDER=${SIP_PROVIDER:-}
- SIP_USERNAME=${SIP_USERNAME:-}
- SIP_PASSWORD=${SIP_PASSWORD:-}
- HOTLINE_NUMBER=${HOTLINE_NUMBER:-}
```

`ARI_REST_URL` is already read by `index.ts` (`process.env.ARI_REST_URL`) but was not included in the compose file. The SIP vars are new and all default to empty string (optional).

### Modified: `deploy/ansible/vars.example.yml`

Add a new SIP trunk section with comments:

```yaml
# ─── SIP Trunk (Asterisk auto-config) ───────────────────────
# If set, sip-bridge will configure the PJSIP trunk at startup
# via the ARI dynamic config API. Leave blank to manage pjsip.conf manually.
sip_provider: ""        # e.g. sip.twilio.com or your SIP provider hostname — OPTIONAL
sip_username: ""        # SIP account username — OPTIONAL
sip_password: ""        # SIP account password — OPTIONAL
hotline_number: ""      # E.164 hotline number, e.g. +15555550100 — OPTIONAL
```

### Modified: `deploy/ansible/roles/llamenos/tasks/main.yml`

Pass new env vars to docker-compose via the env file or inline environment block, consistent with how `ARI_PASSWORD` and `BRIDGE_SECRET` are already passed.

## Files Summary

| File | Action |
|------|--------|
| `sip-bridge/src/pjsip-configurator.ts` | Create |
| `sip-bridge/src/ari-client.ts` | Modify — add `configureDynamic`, `reloadModule` |
| `sip-bridge/src/types.ts` | Modify — add SIP fields to `BridgeConfig` |
| `sip-bridge/src/index.ts` | Modify — read SIP env, call configurator on startup |
| `sip-bridge/asterisk-config/pjsip.conf` | Modify — strip trunk stanzas, keep transports only |
| `deploy/docker/docker-compose.yml` | Modify — add `ARI_REST_URL` and SIP env vars |
| `deploy/ansible/vars.example.yml` | Modify — add SIP trunk section |
| `deploy/ansible/roles/llamenos/tasks/main.yml` | Modify — pass new env vars |

## Dependencies

None. This epic touches only the `sip-bridge` standalone service and deployment config.

## Testing

E2E test file: `tests/asterisk-auto-config.spec.ts`

Since running a full Asterisk instance in CI is impractical, tests use a lightweight mock ARI HTTP server started inside the test. The mock records which `PUT /ari/asterisk/config/dynamic/...` and `PUT /ari/asterisk/modules/...` calls were received.

**Test strategy:**

1. Start a mock HTTP server on a random port that accepts ARI REST calls and records them.
2. Set `ARI_REST_URL` to point at the mock server.
3. Start the bridge with `SIP_PROVIDER`, `SIP_USERNAME`, `SIP_PASSWORD` set.
4. Poll the bridge `/health` endpoint until `sipConfigured: true`.
5. Assert the mock recorded all four `PUT /ari/asterisk/config/dynamic/...` calls and one `PUT /ari/asterisk/modules/res_pjsip.so` call.

**Negative test:** Start the bridge with no SIP env vars. Poll `/health`. Assert `sipConfigSkipped: true` and the mock received zero ARI config calls.

**Idempotency test:** Restart the bridge (stop + start the process). Assert the same config calls are made again without error.
