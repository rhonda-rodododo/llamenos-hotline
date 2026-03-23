# Sub-Project D: Health Monitoring + Post-Setup Admin Management — Design Spec

**Date:** 2026-03-23
**Parent:** [Provider Auto-Registration Master Spec](2026-03-23-provider-auto-registration-design.md)
**Status:** Draft
**Dependencies:** Sub-Project A (ProviderCapabilities — testConnection pattern)

## Problem

1. **No health monitoring**: If a VoIP provider goes down mid-shift, nobody knows until calls fail. There's no background check, no dashboard indicator, no alerts.

2. **No post-setup management**: After initial setup, admins can't switch providers, change phone numbers, or rotate credentials without direct DB manipulation. The admin settings page has a basic form but no guided flow for these operations.

## Goal

Continuous background health monitoring for all active providers with real-time dashboard visibility, plus admin UI flows for switching providers, changing numbers, and rotating credentials — all using the capabilities registry for a provider-agnostic experience.

## Design: Health Monitoring

### Runtime testConnection() on TelephonyAdapter

**File:** `src/server/telephony/adapter.ts` — Add to interface:

```typescript
interface TelephonyAdapter {
  // ... existing methods ...
  testConnection(): Promise<ConnectionTestResult>
}
```

Each adapter implements by hitting its health-check endpoint using stored credentials. This mirrors `ProviderCapabilities.testConnection()` but operates on an already-configured adapter (no raw credentials needed).

MessagingAdapter already has `getChannelStatus(): Promise<ChannelStatus>` — align `ChannelStatus` return type with `ConnectionTestResult` or add an adapter method.

### Background Health Service

**File:** `src/server/services/provider-health.ts` (new)

```typescript
export class ProviderHealthService {
  private results: Map<string, HealthCheckResult> = new Map()
  private interval: Timer | null = null
  private consecutiveFailures: Map<string, number> = new Map()

  start(intervalMs = 60_000): void
  stop(): void
  getHealthStatus(): ProviderHealthStatus
  checkNow(): Promise<ProviderHealthStatus>
}

interface HealthCheckResult {
  provider: string
  channel?: MessagingChannelType
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  lastCheck: string  // ISO timestamp
  consecutiveFailures: number
  error?: string
}

interface ProviderHealthStatus {
  telephony: HealthCheckResult | null
  messaging: Record<MessagingChannelType, HealthCheckResult>
  lastFullCheck: string
}
```

**Behavior:**
- Runs every 60 seconds (configurable via `HEALTH_CHECK_INTERVAL_MS` env var)
- Tests active telephony provider via `adapter.testConnection()`
- Tests each enabled messaging channel via `adapter.getChannelStatus()`
- Stores results in-memory (no DB persistence — health is ephemeral)
- Logs `[health] WARNING: Twilio connection failed (attempt 1/3)` on first failure
- Logs `[health] ERROR: Twilio DOWN — 3 consecutive failures` after threshold
- Publishes status changes via Nostr relay (kind 20001, encrypted with hub key) for real-time dashboard updates

**Lifecycle:** Started in `src/server/server.ts` after DB initialization:
```typescript
const healthService = new ProviderHealthService(services, env)
healthService.start()
```

### Health API Endpoint

**File:** `src/server/routes/settings.ts` — Add:

```typescript
// Use settings:view so shift supervisors and other admins can see health status
settings.get('/provider-health', requirePermission('settings:view'), async (c) => {
  const health = c.get('services').providerHealth.getHealthStatus()
  return c.json(health)
})
```

### Dashboard UI

**File:** `src/client/components/admin-settings/provider-health-badge.tsx` (new)

A compact health indicator component:
- Green dot + "Healthy" + latency (e.g., "142ms")
- Yellow dot + "Degraded" + error snippet
- Red dot + "Down" + consecutive failure count + last successful time
- Clickable to expand full health details

Used in:
- Admin dashboard (top-level overview)
- Admin settings → Telephony Provider section
- Admin settings → each messaging channel section

Real-time updates via Nostr subscription (already have the relay infrastructure).

---

## Design: Post-Setup Admin Management

### Switch Provider Flow

Admin wants to change from Twilio to Vonage (or any other provider):

1. Admin clicks "Switch Provider" in telephony settings
2. UI shows provider picker (dropdown driven by `TELEPHONY_CAPABILITIES` registry)
3. Selecting new provider renders form fields from `capabilities.credentialSchema`
4. Admin enters credentials → `POST /setup/provider/validate` → testConnection
5. If valid, show number management:
   - List numbers from new provider (`capabilities.listOwnedNumbers()`)
   - Or search/provision new number
6. Auto-configure webhooks on new provider (`capabilities.configureWebhooks()`)
7. Confirmation dialog: "Switching from Twilio to Vonage will immediately route all calls through Vonage. Active calls may be interrupted."
8. Save → `PATCH /settings/telephony-provider` (encrypted)
9. Health check runs immediately to verify

### Change Phone Number Flow

Same provider, different number:

1. Admin clicks "Change Number" in telephony settings
2. UI shows owned numbers from `capabilities.listOwnedNumbers()` + search/provision option
3. Admin selects new number
4. Auto-reconfigure webhooks for new number
5. Confirmation: "Changing hotline number. Callers using the old number will no longer reach you."
6. Save updated config

### Rotate Credentials Flow

Same provider and number, new API keys:

1. Admin clicks "Rotate Credentials"
2. UI shows current provider's credential fields (pre-filled except secrets)
3. Admin enters new credentials
4. `testConnection()` validates new credentials work
5. Save (webhooks stay the same, just new auth)
6. Health check verifies immediately

### Admin UI Component

**File:** `src/client/components/admin-settings/telephony-provider-section.tsx` — Enhanced:

The existing component gains three new action buttons:
- "Switch Provider" → opens modal with provider picker + credential form
- "Change Number" → opens modal with number picker
- "Rotate Credentials" → opens modal with credential form

All modals use `ProviderCapabilities` data for form rendering:
- `credentialSchema` drives field validation
- `supportsNumberProvisioning` shows/hides number management
- `supportsWebhookAutoConfig` enables auto-config step

**Consolidate PhoneNumberSelector:** The existing `src/client/components/setup/PhoneNumberSelector.tsx` is refactored to be reusable in both setup wizard and admin settings contexts. No new `phone-number-manager.tsx` — use the same component, driven by the capabilities API:
- Lists owned numbers with capabilities (voice/SMS/MMS)
- Search available numbers by country/area code
- Provision new numbers with confirmation
- Shows monthly cost where available

### Files Changed

- `src/server/telephony/adapter.ts` — ADD: `testConnection()` to TelephonyAdapter interface
- `src/server/telephony/twilio.ts` — IMPLEMENT: `testConnection()`
- `src/server/telephony/signalwire.ts` — IMPLEMENT: `testConnection()`
- `src/server/telephony/vonage.ts` — IMPLEMENT: `testConnection()`
- `src/server/telephony/plivo.ts` — IMPLEMENT: `testConnection()`
- `src/server/telephony/asterisk.ts` — IMPLEMENT: `testConnection()`
- `src/server/services/provider-health.ts` — NEW: background health service
- `src/server/server.ts` — START: health service on boot
- `src/server/routes/settings.ts` — ADD: `GET /provider-health`
- `src/client/components/admin-settings/provider-health-badge.tsx` — NEW: health indicator
- `src/client/components/admin-settings/telephony-provider-section.tsx` — ADD: switch/change/rotate flows
- `src/client/components/setup/PhoneNumberSelector.tsx` — REFACTOR: make reusable for admin context (remove setup-wizard-specific assumptions)

### Testing

- E2E test: `testConnection()` on TwilioAdapter with mock API
- E2E test: ProviderHealthService detects failure → reports 'down' after 3 consecutive failures
- E2E test: ProviderHealthService recovers → reports 'healthy' after success
- E2E test: `GET /provider-health` returns correct status
- E2E test: Health service starts/stops cleanly (no leaked timers)
- E2E test: Admin switch provider flow end-to-end with mock APIs
- E2E test: Admin change number flow
- E2E test: Admin rotate credentials flow
