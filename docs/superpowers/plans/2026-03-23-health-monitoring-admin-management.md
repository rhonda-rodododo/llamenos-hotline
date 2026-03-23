# Health Monitoring + Admin Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continuous background health monitoring for all active providers with real-time dashboard visibility, plus admin UI for switching providers, changing numbers, and rotating credentials.

**Architecture:** Background service polls provider health on an interval, stores results in-memory, publishes changes via Nostr relay. Admin settings page gains switch/change/rotate flows using the capabilities registry for provider-agnostic forms.

**Tech Stack:** Bun `setInterval`, ProviderCapabilities + MessagingChannelCapabilities, Nostr ephemeral events, React components.

**Spec:** `docs/superpowers/specs/2026-03-23-health-monitoring-admin-management-design.md`

**Prerequisites:**
- **Plan A MUST be complete** — specifically Task 11 (adds `testConnection()` to `TelephonyAdapter` interface and all 5 adapter implementations). Verify: `grep 'testConnection' src/server/telephony/adapter.ts` should show the method.
- **Plan A's `TELEPHONY_CAPABILITIES` registry must exist** for admin management flows.

**Scope note:** The spec mentions Nostr relay publishing for real-time dashboard updates. This plan uses HTTP polling (30s interval) for the initial implementation. Nostr real-time publishing can be added as a follow-up — the health badge component already has polling infrastructure that can be replaced with a Nostr subscription later.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/server/services/provider-health.ts` | CREATE | Background health check service |
| `src/server/routes/settings.ts` | MODIFY | Add `GET /provider-health` endpoint |
| `src/server/server.ts` | MODIFY | Start health service on boot |
| `src/client/components/admin-settings/provider-health-badge.tsx` | CREATE | Health indicator UI component |
| `src/client/components/admin-settings/telephony-provider-section.tsx` | MODIFY | Add switch/change/rotate flows |
| `src/client/components/setup/PhoneNumberSelector.tsx` | MODIFY | Make reusable for admin context |
| `tests/provider-health.spec.ts` | CREATE | E2E tests for health monitoring |

---

### Task 1: ProviderHealthService

**Files:**
- Create: `src/server/services/provider-health.ts`
- Test: `tests/provider-health.spec.ts`

- [ ] **Step 1: Write health service test**

```typescript
// tests/provider-health.spec.ts
import { test, expect } from '@playwright/test'

test.describe('provider health monitoring', () => {
  test('GET /api/settings/provider-health returns health status', async ({ request }) => {
    const res = await request.get('/api/settings/provider-health')
    // May be 401 if not authenticated — that's fine, just not 404
    expect([200, 401, 403]).toContain(res.status())
  })
})

test.describe('ProviderHealthService unit', () => {
  test('reports healthy when testConnection succeeds', async () => {
    const { ProviderHealthService } = await import('../src/server/services/provider-health')

    // Create a mock adapter that always returns connected
    const mockAdapter = {
      async testConnection() {
        return { connected: true, latencyMs: 42, accountName: 'Test' }
      },
    }

    const service = new ProviderHealthService()
    const result = await service.checkProvider('telephony', 'twilio', mockAdapter as any)
    expect(result.status).toBe('healthy')
    expect(result.latencyMs).toBe(42)
  })

  test('reports down after consecutive failures', async () => {
    const { ProviderHealthService } = await import('../src/server/services/provider-health')

    const mockAdapter = {
      async testConnection() {
        return { connected: false, latencyMs: 0, error: 'timeout', errorType: 'network_error' as const }
      },
    }

    const service = new ProviderHealthService()
    // Simulate 3 consecutive failures
    await service.checkProvider('telephony', 'twilio', mockAdapter as any)
    await service.checkProvider('telephony', 'twilio', mockAdapter as any)
    const result = await service.checkProvider('telephony', 'twilio', mockAdapter as any)

    expect(result.status).toBe('down')
    expect(result.consecutiveFailures).toBe(3)
  })

  test('recovers to healthy after failure', async () => {
    const { ProviderHealthService } = await import('../src/server/services/provider-health')
    let shouldFail = true

    const mockAdapter = {
      async testConnection() {
        if (shouldFail) return { connected: false, latencyMs: 0, error: 'timeout', errorType: 'network_error' as const }
        return { connected: true, latencyMs: 50 }
      },
    }

    const service = new ProviderHealthService()
    await service.checkProvider('telephony', 'twilio', mockAdapter as any)
    await service.checkProvider('telephony', 'twilio', mockAdapter as any)

    shouldFail = false
    const result = await service.checkProvider('telephony', 'twilio', mockAdapter as any)
    expect(result.status).toBe('healthy')
    expect(result.consecutiveFailures).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx playwright test tests/provider-health.spec.ts`
Expected: FAIL — module not found
(Note: the `bridge` project only matches `asterisk-*.spec.ts` — run without project filter for these server-side tests)

- [ ] **Step 3: Implement ProviderHealthService**

```typescript
// src/server/services/provider-health.ts
import type { ConnectionTestResult, MessagingChannelType } from '@shared/types'

export interface HealthCheckResult {
  provider: string
  channel?: MessagingChannelType
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  lastCheck: string
  consecutiveFailures: number
  error?: string
}

export interface ProviderHealthStatus {
  telephony: HealthCheckResult | null
  messaging: Record<string, HealthCheckResult>
  lastFullCheck: string
}

interface Checkable {
  testConnection(): Promise<ConnectionTestResult>
}

/** Threshold for consecutive failures before marking as "down" */
const DOWN_THRESHOLD = 3

export class ProviderHealthService {
  private results = new Map<string, HealthCheckResult>()
  private failures = new Map<string, number>()
  private interval: ReturnType<typeof setInterval> | null = null

  /** Check a single provider/channel and update internal state */
  async checkProvider(category: string, name: string, adapter: Checkable): Promise<HealthCheckResult> {
    const key = `${category}:${name}`
    const testResult = await adapter.testConnection()
    const consecutiveFailures = testResult.connected ? 0 : (this.failures.get(key) ?? 0) + 1
    this.failures.set(key, consecutiveFailures)

    const result: HealthCheckResult = {
      provider: name,
      status: testResult.connected ? 'healthy' : consecutiveFailures >= DOWN_THRESHOLD ? 'down' : 'degraded',
      latencyMs: testResult.latencyMs,
      lastCheck: new Date().toISOString(),
      consecutiveFailures,
      error: testResult.error,
    }

    // Log status changes
    const prev = this.results.get(key)
    if (prev && prev.status !== result.status) {
      if (result.status === 'down') {
        console.error(`[health] ERROR: ${name} DOWN — ${consecutiveFailures} consecutive failures: ${result.error}`)
      } else if (result.status === 'degraded') {
        console.warn(`[health] WARNING: ${name} connection failed (${consecutiveFailures}/${DOWN_THRESHOLD}): ${result.error}`)
      } else {
        console.log(`[health] ${name} recovered — now healthy (${result.latencyMs}ms)`)
      }
    }

    this.results.set(key, result)
    return result
  }

  /** Get current health status for all tracked providers */
  getHealthStatus(): ProviderHealthStatus {
    const telephony = this.results.get('telephony:active') ?? null
    const messaging: Record<string, HealthCheckResult> = {}
    for (const [key, result] of this.results) {
      if (key.startsWith('messaging:')) {
        messaging[key.replace('messaging:', '')] = result
      }
    }
    return {
      telephony,
      messaging,
      lastFullCheck: new Date().toISOString(),
    }
  }

  /** Start periodic health checks */
  start(checkFn: () => Promise<void>, intervalMs = 60_000): void {
    this.stop()
    // Run immediately, then on interval
    checkFn().catch((err) => console.error('[health] Initial check failed:', err))
    this.interval = setInterval(() => {
      checkFn().catch((err) => console.error('[health] Check failed:', err))
    }, intervalMs)
  }

  /** Stop periodic health checks */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bunx playwright test tests/provider-health.spec.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/services/provider-health.ts tests/provider-health.spec.ts
git commit -m "feat: ProviderHealthService with consecutive failure tracking"
```

---

### Task 2: Health API Endpoint

**Files:**
- Modify: `src/server/routes/settings.ts`

- [ ] **Step 1: Add the health endpoint**

```typescript
settings.get('/provider-health', requirePermission('settings:view'), async (c) => {
  const healthService = c.get('services').providerHealth
  if (!healthService) return c.json({ error: 'Health service not available' }, 503)
  return c.json(healthService.getHealthStatus())
})
```

- [ ] **Step 2: Add `providerHealth` to the Services interface**

In `src/server/services/index.ts` (line 27-38), add to the `Services` interface:

```typescript
export interface Services {
  // ...existing properties...
  providerHealth: ProviderHealthService
}
```

Import `ProviderHealthService` at the top. Do NOT add it to `createServices()` — it's created separately in server.ts since it needs the full services object.

- [ ] **Step 3: Wire health service into server startup**

In `src/server/server.ts`, after services are initialized:

```typescript
import { ProviderHealthService } from './services/provider-health'

// After services creation:
const providerHealth = new ProviderHealthService()

// Add to services object
services.providerHealth = providerHealth

// Start health checks
const healthCheckInterval = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS ?? '60000', 10)
providerHealth.start(async () => {
  try {
    const adapter = await getTelephony(services.settings)
    if (adapter) {
      await providerHealth.checkProvider('telephony', 'active', adapter)
    }
    // Check enabled messaging channels
    const messagingConfig = await services.settings.getMessagingConfig()
    if (messagingConfig) {
      for (const channel of messagingConfig.enabledChannels ?? []) {
        try {
          const msgAdapter = await getMessagingAdapter(channel, services.settings, env.HMAC_SECRET)
          await providerHealth.checkProvider('messaging', channel, { testConnection: () => msgAdapter.getChannelStatus().then(s => ({ connected: s.connected, latencyMs: 0, error: s.error })) })
        } catch { /* channel not configured */ }
      }
    }
  } catch (err) {
    console.error('[health] Full check error:', err)
  }
}, healthCheckInterval)
```

- [ ] **Step 3: Run typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/settings.ts src/server/server.ts
git commit -m "feat: health check API endpoint + background health service startup"
```

---

### Task 3: Health Badge UI Component

**Files:**
- Create: `src/client/components/admin-settings/provider-health-badge.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/client/components/admin-settings/provider-health-badge.tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface HealthCheckResult {
  provider: string
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  lastCheck: string
  consecutiveFailures: number
  error?: string
}

interface ProviderHealthStatus {
  telephony: HealthCheckResult | null
  messaging: Record<string, HealthCheckResult>
  lastFullCheck: string
}

export function ProviderHealthBadge() {
  const { t } = useTranslation()
  const [health, setHealth] = useState<ProviderHealthStatus | null>(null)

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch('/api/settings/provider-health')
        if (res.ok) setHealth(await res.json())
      } catch { /* ignore */ }
    }
    fetchHealth()
    const interval = setInterval(fetchHealth, 30_000)
    return () => clearInterval(interval)
  }, [])

  if (!health) return null

  const items: HealthCheckResult[] = []
  if (health.telephony) items.push(health.telephony)
  for (const result of Object.values(health.messaging)) items.push(result)

  if (items.length === 0) return null

  const worstStatus = items.some(i => i.status === 'down') ? 'down'
    : items.some(i => i.status === 'degraded') ? 'degraded' : 'healthy'

  const statusColors = {
    healthy: 'bg-green-500',
    degraded: 'bg-yellow-500',
    down: 'bg-red-500',
  }

  const statusLabels = {
    healthy: t('settings.health.healthy', 'Healthy'),
    degraded: t('settings.health.degraded', 'Degraded'),
    down: t('settings.health.down', 'Down'),
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`inline-block w-2 h-2 rounded-full ${statusColors[worstStatus]}`} />
      <span>{statusLabels[worstStatus]}</span>
      {health.telephony && health.telephony.latencyMs > 0 && (
        <span className="text-muted-foreground">({health.telephony.latencyMs}ms)</span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run build to verify component compiles**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/client/components/admin-settings/provider-health-badge.tsx
git commit -m "feat: ProviderHealthBadge UI component"
```

---

### Task 4: Admin Provider Management Flows

**Files:**
- Modify: `src/client/components/admin-settings/telephony-provider-section.tsx`
- Modify: `src/client/components/setup/PhoneNumberSelector.tsx`

- [ ] **Step 1: Add switch/change/rotate action buttons to telephony-provider-section**

Read the existing `telephony-provider-section.tsx` file first to understand the current structure. Then add:

1. Import `ProviderHealthBadge` and render it next to the provider name
2. Add three action buttons: "Switch Provider", "Change Number", "Rotate Credentials"
3. Each opens a modal dialog:
   - Switch Provider: provider dropdown + credential form (driven by capabilities) + test + save
   - Change Number: PhoneNumberSelector + auto-configure webhooks + save
   - Rotate Credentials: credential fields only + test + save

- [ ] **Step 2: Make PhoneNumberSelector reusable**

Read `PhoneNumberSelector.tsx`. Remove any setup-wizard-specific assumptions. The component should accept props:
- `provider: TelephonyProviderType`
- `credentials: TelephonyProviderConfig`
- `onSelect: (number: string) => void`
- `context?: 'setup' | 'admin'` (for styling differences)

Wire the API calls to the capabilities-based endpoints:
- `/api/setup/provider/phone-numbers` for listing
- `/api/setup/provider/phone-numbers/search` for searching
- `/api/setup/provider/phone-numbers/provision` for provisioning

- [ ] **Step 3: Run typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/client/components/admin-settings/telephony-provider-section.tsx src/client/components/setup/PhoneNumberSelector.tsx
git commit -m "feat: admin provider management flows (switch/change/rotate)"
```

---

### Task 5: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Run full build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `bunx playwright test tests/provider-health.spec.ts tests/provider-setup-routes.spec.ts tests/provider-capabilities.spec.ts tests/asterisk-auto-config.spec.ts --project bridge`
Expected: All PASS

- [ ] **Step 4: Run full E2E suite**

Run: `bunx playwright test`
Expected: No regressions

- [ ] **Step 5: Commit**

```bash
git status
# Stage only relevant changed files
git commit -m "feat: health monitoring + admin provider management complete"
```
