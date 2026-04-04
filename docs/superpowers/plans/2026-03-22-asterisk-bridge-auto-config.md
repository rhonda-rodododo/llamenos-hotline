# Asterisk Bridge Auto-Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** When `sip-bridge` starts with SIP credentials in the environment, it automatically configures the Asterisk PJSIP trunk via ARI's dynamic config REST API and reloads the PJSIP module — no manual `pjsip.conf` editing required.

**Architecture:** `sip-bridge` gains a `PjsipConfigurator` class that calls `PUT /ari/asterisk/config/dynamic/{configClass}/{objectType}/{id}` for four PJSIP objects (auth, aor, endpoint, registration), then calls `PUT /ari/asterisk/modules/res_pjsip.so`. `AriClient` gains two public methods (`configureDynamic`, `reloadModule`) that delegate to its existing `private request<T>()`. The static `pjsip.conf` is stripped to transport-only stanzas; all trunk config is managed at runtime.

**Tech Stack:** Bun, TypeScript, Asterisk ARI REST API, Docker Compose, Ansible, Playwright E2E tests

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `sip-bridge/src/pjsip-configurator.ts` | **Create** | `PjsipConfigurator` class — writes 4 PJSIP objects + reloads module |
| `sip-bridge/src/ari-client.ts` | **Modify** | Add `configureDynamic()` and `reloadModule()` public methods |
| `sip-bridge/src/types.ts` | **Modify** | Add `sipProvider?`, `sipUsername?`, `sipPassword?` to `BridgeConfig` |
| `sip-bridge/src/index.ts` | **Modify** | Read SIP env vars; call configurator after ARI connects; expose `sipConfigured`/`sipConfigSkipped` in `/health` |
| `sip-bridge/asterisk-config/pjsip.conf` | **Modify** | Remove trunk stanzas; keep `transport-udp` and `transport-tcp` only |
| `deploy/docker/docker-compose.yml` | **Modify** | Add `ARI_REST_URL`, `SIP_PROVIDER`, `SIP_USERNAME`, `SIP_PASSWORD`, `HOTLINE_NUMBER` to `sip-bridge` env |
| `deploy/ansible/vars.example.yml` | **Modify** | Add SIP trunk section with comments |
| `deploy/ansible/roles/llamenos/tasks/main.yml` | **Modify** | Pass new SIP env vars to docker-compose |
| `tests/asterisk-auto-config.spec.ts` | **Create** | E2E tests using a mock ARI HTTP server |

---

## Tasks

### Task 1: Write the failing E2E test

**Files:**
- Create: `tests/asterisk-auto-config.spec.ts`

The test must fail before implementation because `sipConfigured` and `sipConfigSkipped` do not exist on the `/health` response yet, and the bridge does not call any ARI config endpoints at startup.

- [x] Create `tests/asterisk-auto-config.spec.ts` with the following test structure:

  ```typescript
  import { test, expect } from '@playwright/test'
  import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
  import { spawn, type ChildProcess } from 'node:child_process'

  // Starts a mock ARI HTTP server that records PUT requests
  async function startMockAri(port: number): Promise<{
    calls: Array<{ method: string; path: string; body: string }>
    stop: () => Promise<void>
  }> {
    const calls: Array<{ method: string; path: string; body: string }> = []
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString() })
      req.on('end', () => {
        calls.push({ method: req.method ?? '', path: req.url ?? '', body })
        // Mock WebSocket upgrade check for ARI WS connect attempt
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{}')
      })
    })
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    return {
      calls,
      stop: () => new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
    }
  }
  ```

- [x] Add `test('auto-configures PJSIP trunk when SIP env vars are present', ...)`:
  - Start mock ARI server on port 18088
  - Spawn bridge process with env: `ARI_URL=ws://127.0.0.1:18088/ari/events`, `ARI_REST_URL=http://127.0.0.1:18088/ari`, `ARI_USERNAME=test`, `ARI_PASSWORD=test`, `WORKER_WEBHOOK_URL=http://127.0.0.1:9999`, `BRIDGE_SECRET=testsecret`, `SIP_PROVIDER=sip.example.com`, `SIP_USERNAME=testuser`, `SIP_PASSWORD=testpass`, `BRIDGE_PORT=13001`
  - Poll `http://127.0.0.1:13001/health` until `sipConfigured === true` (max 10s)
  - Assert mock ARI server received:
    - `PUT /ari/asterisk/config/dynamic/res_pjsip/auth/trunk-auth`
    - `PUT /ari/asterisk/config/dynamic/res_pjsip/aor/trunk`
    - `PUT /ari/asterisk/config/dynamic/res_pjsip/endpoint/trunk`
    - `PUT /ari/asterisk/config/dynamic/res_pjsip/registration/trunk-reg`
    - `PUT /ari/asterisk/modules/res_pjsip.so`
  - Kill bridge process and stop mock server

- [x] Add `test('skips PJSIP config when SIP env vars are absent', ...)`:
  - Start mock ARI server on port 18089
  - Spawn bridge with no `SIP_PROVIDER`/`SIP_USERNAME`/`SIP_PASSWORD` set
  - Poll `/health` until `sipConfigSkipped === true` (max 10s)
  - Assert mock received zero calls matching `/ari/asterisk/config/dynamic/`
  - Kill bridge and stop mock server

- [x] Add `test('PJSIP auto-config is idempotent across restarts', ...)`:
  - Start mock ARI server on port 18090
  - Spawn bridge → wait for `sipConfigured: true` → kill bridge
  - Reset recorded calls array
  - Spawn bridge again with same env
  - Wait for `sipConfigured: true` again
  - Assert all five ARI calls were made again (no error on second run)
  - Kill bridge and stop mock server

- [x] Run to verify tests fail: `bunx playwright test tests/asterisk-auto-config.spec.ts`
  - Expected: tests fail because `/health` has no `sipConfigured` field

---

### Task 2: Add SIP fields to `BridgeConfig` type

**Files:**
- Modify: `sip-bridge/src/types.ts`

- [x] Add three optional fields to the `BridgeConfig` interface (after the existing `stasisApp` field):
  ```typescript
  /** SIP provider hostname for PJSIP trunk auto-config (e.g. sip.twilio.com) */
  sipProvider?: string
  /** SIP username for PJSIP trunk registration */
  sipUsername?: string
  /** SIP password for PJSIP trunk registration */
  sipPassword?: string
  ```

- [x] Run `cd sip-bridge && bun run typecheck` (if a typecheck script exists) or `bunx tsc --noEmit` — must pass

---

### Task 3: Add `configureDynamic` and `reloadModule` to `AriClient`

**Files:**
- Modify: `sip-bridge/src/ari-client.ts`

- [x] Read the existing `private request<T>()` method signature to understand its call convention
- [x] Add after the existing public channel/bridge methods:
  ```typescript
  /**
   * Write or update a PJSIP config object via ARI dynamic config API.
   * PUT /asterisk/config/dynamic/{configClass}/{objectType}/{id}
   * Idempotent — creates or replaces the object.
   */
  async configureDynamic(
    configClass: string,
    objectType: string,
    id: string,
    fields: Record<string, string>
  ): Promise<void> {
    await this.request<void>('PUT', `/asterisk/config/dynamic/${configClass}/${objectType}/${id}`, {
      fields: Object.entries(fields).map(([attribute, value]) => ({ attribute, value })),
    })
  }

  /**
   * Reload an Asterisk module via ARI.
   * PUT /asterisk/modules/{moduleName}
   */
  async reloadModule(moduleName: string): Promise<void> {
    await this.request<void>('PUT', `/asterisk/modules/${moduleName}`)
  }
  ```

- [x] Verify the `request<void>` call is consistent with how `void` returns are handled in the existing method (check if it expects a JSON body or not, handle 204 responses correctly)
- [x] Run `cd sip-bridge && bunx tsc --noEmit` — must pass with no new errors

---

### Task 4: Create `PjsipConfigurator`

**Files:**
- Create: `sip-bridge/src/pjsip-configurator.ts`

- [x] Create the file:
  ```typescript
  import type { AriClient } from './ari-client'

  /**
   * PjsipConfigurator — writes PJSIP trunk config to Asterisk via ARI
   * dynamic config API, then reloads res_pjsip.
   *
   * Idempotent: ARI PUT config creates-or-replaces, so safe on every restart.
   */
  export class PjsipConfigurator {
    constructor(private readonly ari: AriClient) {}

    async configure(provider: string, username: string, password: string): Promise<void> {
      console.log('[pjsip] Auto-configuring PJSIP trunk...')

      // 1. Auth object
      console.log('[pjsip] Configuring auth/trunk-auth...')
      await this.ari.configureDynamic('res_pjsip', 'auth', 'trunk-auth', {
        auth_type: 'userpass',
        username,
        password,
      })

      // 2. AOR (Address of Record)
      console.log('[pjsip] Configuring aor/trunk...')
      await this.ari.configureDynamic('res_pjsip', 'aor', 'trunk', {
        contact: `sip:${username}@${provider}`,
        qualify_frequency: '60',
      })

      // 3. Endpoint
      console.log('[pjsip] Configuring endpoint/trunk...')
      await this.ari.configureDynamic('res_pjsip', 'endpoint', 'trunk', {
        transport: 'transport-udp',
        context: 'from-trunk',
        disallow: 'all',
        allow: 'ulaw,alaw',
        outbound_auth: 'trunk-auth',
        aors: 'trunk',
      })

      // 4. Outbound registration
      console.log('[pjsip] Configuring registration/trunk-reg...')
      await this.ari.configureDynamic('res_pjsip', 'registration', 'trunk-reg', {
        transport: 'transport-udp',
        outbound_auth: 'trunk-auth',
        server_uri: `sip:${provider}`,
        client_uri: `sip:${username}@${provider}`,
        retry_interval: '60',
        forbidden_retry_interval: '600',
        expiration: '3600',
      })

      // 5. Reload module to apply
      console.log('[pjsip] Reloading res_pjsip.so...')
      await this.ari.reloadModule('res_pjsip.so')

      console.log('[pjsip] PJSIP trunk configured successfully')
    }
  }
  ```

- [x] Run `cd sip-bridge && bunx tsc --noEmit` — must pass

---

### Task 5: Wire auto-config into `index.ts`

**Files:**
- Modify: `sip-bridge/src/index.ts`

- [x] In `loadConfig()`, add optional SIP field reads after `stasisApp`:
  ```typescript
  const sipProvider = process.env.SIP_PROVIDER || undefined
  const sipUsername = process.env.SIP_USERNAME || undefined
  const sipPassword = process.env.SIP_PASSWORD || undefined
  ```
  Add them to the returned `BridgeConfig` object:
  ```typescript
  sipProvider,
  sipUsername,
  sipPassword,
  ```

- [x] Add `import { PjsipConfigurator } from './pjsip-configurator'` at the top of the file

- [x] In `main()`, add a `sipConfigured` and `sipConfigSkipped` tracking variable:
  ```typescript
  let sipConfigured = false
  let sipConfigSkipped = false
  ```

- [x] After the `ari.connect()` try/catch block, add the auto-config block:
  ```typescript
  if (config.sipProvider && config.sipUsername && config.sipPassword) {
    const pjsip = new PjsipConfigurator(ari)
    try {
      await pjsip.configure(config.sipProvider, config.sipUsername, config.sipPassword)
      sipConfigured = true
    } catch (err) {
      console.error('[bridge] PJSIP auto-config failed (continuing):', err)
    }
  } else {
    sipConfigSkipped = true
    console.log('[bridge] SIP env vars not set — skipping PJSIP auto-config')
  }
  ```

- [x] In the `/health` handler, add `sipConfigured` and `sipConfigSkipped` to the response:
  ```typescript
  return Response.json({
    status: 'ok',
    uptime: process.uptime(),
    sipConfigured,
    sipConfigSkipped,
    ...status,
  })
  ```

- [x] Run `cd sip-bridge && bunx tsc --noEmit` — must pass

---

### Task 6: Simplify `pjsip.conf`

**Files:**
- Modify: `sip-bridge/asterisk-config/pjsip.conf`

- [x] Read the current file to identify all existing stanzas
- [x] Replace the file content with transport-only config:
  ```ini
  ; pjsip.conf — Transport configuration only.
  ;
  ; Trunk, auth, AOR, and registration objects are configured dynamically
  ; at startup by sip-bridge via the ARI dynamic config API
  ; (PUT /ari/asterisk/config/dynamic/res_pjsip/...).
  ;
  ; To configure the SIP trunk, set these environment variables:
  ;   SIP_PROVIDER   — SIP provider hostname (e.g. sip.twilio.com)
  ;   SIP_USERNAME   — SIP account username
  ;   SIP_PASSWORD   — SIP account password

  [transport-udp]
  type=transport
  protocol=udp
  bind=0.0.0.0

  [transport-tcp]
  type=transport
  protocol=tcp
  bind=0.0.0.0
  ```

---

### Task 7: Update Docker Compose

**Files:**
- Modify: `deploy/docker/docker-compose.yml`

- [x] Read the current `sip-bridge` service `environment` block
- [x] Add the following entries (preserving existing entries):
  ```yaml
  - ARI_REST_URL=http://asterisk:8088/ari
  - SIP_PROVIDER=${SIP_PROVIDER:-}
  - SIP_USERNAME=${SIP_USERNAME:-}
  - SIP_PASSWORD=${SIP_PASSWORD:-}
  - HOTLINE_NUMBER=${HOTLINE_NUMBER:-}
  ```
  Note: `ARI_REST_URL` may already be present — check before adding to avoid duplication.

- [x] Verify the compose file is valid YAML by reviewing the diff carefully

---

### Task 8: Update Ansible vars and tasks

**Files:**
- Modify: `deploy/ansible/vars.example.yml`
- Modify: `deploy/ansible/roles/llamenos/tasks/main.yml`

- [x] Read `deploy/ansible/vars.example.yml` to find the appropriate section to insert the SIP block (after telephony/ARI vars if present, otherwise near end of file)
- [x] Add to `vars.example.yml`:
  ```yaml
  # ─── SIP Trunk (Asterisk PJSIP auto-config) ──────────────────
  # When set, sip-bridge configures the PJSIP trunk at startup via
  # the ARI dynamic config API. Leave blank to manage pjsip.conf manually.
  sip_provider: ""          # SIP provider hostname — OPTIONAL (e.g. sip.twilio.com)
  sip_username: ""          # SIP account username — OPTIONAL
  sip_password: ""          # SIP account password — OPTIONAL
  hotline_number: ""        # E.164 hotline number — OPTIONAL (e.g. +15555550100)
  ```

- [x] Read `deploy/ansible/roles/llamenos/tasks/main.yml` to understand how env vars are passed to the docker-compose invocation
- [x] Pass the four new vars consistently with the existing pattern (env file block or `environment` dict in the docker_compose_v2 task)

---

### Task 9: Run tests and verify

- [x] Run the full E2E test file: `bunx playwright test tests/asterisk-auto-config.spec.ts`
  - All three tests (auto-config present, auto-config skipped, idempotency) must pass

- [x] Run full typecheck: `cd sip-bridge && bunx tsc --noEmit`
  - Must pass with zero errors

- [x] Run root typecheck: `bun run typecheck`
  - Must pass (confirms no shared type regressions)

- [x] Manual smoke check: start `docker compose -f deploy/docker/docker-compose.yml up asterisk sip-bridge` with `SIP_PROVIDER`, `SIP_USERNAME`, `SIP_PASSWORD` set in `.env`. Check bridge logs for:
  ```
  [pjsip] Auto-configuring PJSIP trunk...
  [pjsip] Configuring auth/trunk-auth...
  [pjsip] Configuring aor/trunk...
  [pjsip] Configuring endpoint/trunk...
  [pjsip] Configuring registration/trunk-reg...
  [pjsip] Reloading res_pjsip.so...
  [pjsip] PJSIP trunk configured successfully
  [bridge] PJSIP trunk configured successfully
  ```

- [x] Commit: `git add sip-bridge/src/ sip-bridge/asterisk-config/pjsip.conf deploy/ tests/asterisk-auto-config.spec.ts && git commit -m "feat(sip-bridge): auto-configure PJSIP trunk at startup via ARI dynamic config"`
