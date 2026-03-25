# Voicemail Phase 2: Permissions + Voicemail-Only Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add voicemail-specific permissions (PBAC), a Voicemail Reviewer default role, voicemail-only mode with auto-detection, and the `handleUnavailable` adapter method.

**Architecture:** New `voicemail:*` permission domain in the existing PBAC catalog. Three-way `voicemailMode` setting (`auto`/`always`/`never`) checked in the `/language-selected` telephony handler before enqueue. Auto mode detects when nobody is available to ring. New `handleUnavailable` adapter method for the `never` + nobody available case.

**Tech Stack:** Same as Phase 1 — Bun, Hono, Drizzle ORM, PostgreSQL, React + shadcn/ui, TanStack Router.

**Spec:** `docs/superpowers/specs/2026-03-25-voicemail-completion-design.md` (Phase 2)

**Depends on:** Phase 1 complete (crypto labels, schema, adapter methods, persistence fix).

---

## File Structure

### Modified
| File | Responsibility |
|---|---|
| `src/shared/permissions.ts` | Add `voicemail:*` permissions, Voicemail Reviewer role, update Hub Admin + Volunteer defaults |
| `src/server/db/schema/settings.ts` | Add `voicemailMode` column to `call_settings` |
| `src/shared/schemas/settings.ts` | Add `voicemailMode` to `CallSettingsSchema` |
| `src/server/types.ts` | Add `voicemailMode` to `CallSettings` interface |
| `src/server/services/settings.ts` | Handle `voicemailMode` in get/update |
| `src/client/lib/api.ts` | Add `voicemailMode` to client `CallSettings` |
| `src/client/components/admin-settings/call-settings-section.tsx` | Add voicemail mode selector UI |
| `src/server/routes/telephony.ts` | Voicemail-only routing in `/language-selected` handler |
| `src/server/telephony/adapter.ts` | Add `handleUnavailable()` interface method |
| `src/server/telephony/twilio.ts` | Implement `handleUnavailable()` |
| `src/server/telephony/plivo.ts` | Implement `handleUnavailable()` |
| `src/server/telephony/vonage.ts` | Implement `handleUnavailable()` |
| `src/server/telephony/asterisk.ts` | Implement `handleUnavailable()` |
| `src/server/telephony/test.ts` | Implement `handleUnavailable()` stub |
| `src/shared/voice-prompts.ts` | Add `unavailableMessage` prompt (13 locales) |

### New
| File | Responsibility |
|---|---|
| `src/client/locales/*.json` | i18n keys for voicemail mode UI labels |

### Migrations
| File | Description |
|---|---|
| `src/server/db/migrations/NNNN_voicemail_mode.sql` | Add `voicemail_mode` text column to `call_settings` |

---

## Task 1: Add Voicemail Permissions + Voicemail Reviewer Role

**Files:**
- Modify: `src/shared/permissions.ts`

- [ ] **Step 1: Add voicemail permissions to PERMISSION_CATALOG**

In `src/shared/permissions.ts`, add a new section after the Files domain (around line 108):

```ts
// Voicemail
'voicemail:listen': 'Play/decrypt voicemail audio',
'voicemail:read': 'View voicemail metadata in call history',
'voicemail:notify': 'Receive notifications for new voicemails',
'voicemail:delete': 'Delete voicemail audio and transcript',
'voicemail:manage': 'Configure voicemail settings',
```

- [ ] **Step 2: Update Hub Admin role**

In the Hub Admin role definition (around line 165), add `'voicemail:*'` to the permissions array.

- [ ] **Step 3: Update Volunteer role**

In the Volunteer role definition (around line 213), add `'voicemail:read'` and `'calls:read-history'` to the permissions array. Volunteers need `calls:read-history` to see the call history list where voicemail badges appear.

- [ ] **Step 4: Add Voicemail Reviewer default role**

Add a new role to `DEFAULT_ROLES` array after the Reporter role:

```ts
{
  id: 'role-voicemail-reviewer',
  name: 'Voicemail Reviewer',
  slug: 'voicemail-reviewer',
  permissions: [
    'voicemail:listen',
    'voicemail:read',
    'voicemail:notify',
    'notes:read-all',
    'contacts:read',
    'calls:read-history',
  ],
  isDefault: true,
  isSystem: false,
  description: 'Triages voicemails — listens, reads transcripts, and receives notifications',
},
```

- [ ] **Step 5: Write unit test for permissions**

Create or add to a colocated test file (e.g., `src/shared/permissions.test.ts`):

```ts
import { describe, expect, test } from 'bun:test'
import { DEFAULT_ROLES, hasPermission, PERMISSION_CATALOG } from './permissions'

describe('voicemail permissions', () => {
  test('voicemail:* permissions exist in catalog', () => {
    expect(PERMISSION_CATALOG['voicemail:listen']).toBeDefined()
    expect(PERMISSION_CATALOG['voicemail:read']).toBeDefined()
    expect(PERMISSION_CATALOG['voicemail:notify']).toBeDefined()
    expect(PERMISSION_CATALOG['voicemail:delete']).toBeDefined()
    expect(PERMISSION_CATALOG['voicemail:manage']).toBeDefined()
  })

  test('Hub Admin has voicemail:* wildcard', () => {
    const hubAdmin = DEFAULT_ROLES.find(r => r.id === 'role-hub-admin')!
    expect(hasPermission([hubAdmin.id], DEFAULT_ROLES as any, 'voicemail:listen')).toBe(true)
    expect(hasPermission([hubAdmin.id], DEFAULT_ROLES as any, 'voicemail:manage')).toBe(true)
  })

  test('Volunteer has voicemail:read and calls:read-history', () => {
    const volunteer = DEFAULT_ROLES.find(r => r.id === 'role-volunteer')!
    expect(volunteer.permissions).toContain('voicemail:read')
    expect(volunteer.permissions).toContain('calls:read-history')
    expect(volunteer.permissions).not.toContain('voicemail:listen')
  })

  test('Voicemail Reviewer role exists with correct permissions', () => {
    const reviewer = DEFAULT_ROLES.find(r => r.id === 'role-voicemail-reviewer')!
    expect(reviewer).toBeDefined()
    expect(reviewer.permissions).toContain('voicemail:listen')
    expect(reviewer.permissions).toContain('voicemail:read')
    expect(reviewer.permissions).toContain('voicemail:notify')
    expect(reviewer.permissions).toContain('notes:read-all')
    expect(reviewer.permissions).toContain('calls:read-history')
  })
})
```

- [ ] **Step 6: Run typecheck and tests**

Run: `bun run typecheck && bun test src/shared/permissions.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/permissions.ts src/shared/permissions.test.ts
git commit -m "feat: add voicemail:* permission domain and Voicemail Reviewer role"
```

---

## Task 2: Add voicemailMode Setting (Schema + Service + API)

**Files:**
- Modify: `src/server/db/schema/settings.ts`
- Modify: `src/shared/schemas/settings.ts`
- Modify: `src/server/types.ts`
- Modify: `src/server/services/settings.ts`
- Modify: `src/client/lib/api.ts`
- Create: migration

- [ ] **Step 1: Add voicemailMode and voicemailRetentionDays to DB schema**

In `src/server/db/schema/settings.ts`, add to the `callSettings` table:

```ts
voicemailMode: text('voicemail_mode').notNull().default('auto'),
voicemailRetentionDays: integer('voicemail_retention_days'), // nullable — null = keep forever
```

Valid `voicemailMode` values: `'auto'`, `'always'`, `'never'`.

- [ ] **Step 2: Add to Zod schema**

In `src/shared/schemas/settings.ts`, add to `CallSettingsSchema`:

```ts
voicemailMode: z.enum(['auto', 'always', 'never']).default('auto'),
voicemailRetentionDays: z.number().int().positive().nullable().optional(),
callRecordingMaxBytes: z.number().int().positive().optional(),
```

Note: `callRecordingMaxBytes` exists in the DB but was missing from the Zod schema — fix this pre-existing gap.

- [ ] **Step 3: Add to server CallSettings type**

In `src/server/types.ts`, find the `CallSettings` interface and add:

```ts
voicemailMode: 'auto' | 'always' | 'never'
voicemailRetentionDays: number | null
callRecordingMaxBytes: number
```

Note: `callRecordingMaxBytes` was missing from this interface despite existing in the DB. Fix while here.

- [ ] **Step 4: Add to client CallSettings type**

In `src/client/lib/api.ts`, find the `CallSettings` interface and add:

```ts
voicemailMode: 'auto' | 'always' | 'never'
voicemailRetentionDays: number | null
callRecordingMaxBytes: number
```

- [ ] **Step 5: Wire in settings service**

In `src/server/services/settings.ts`, ensure `getCallSettings` returns `voicemailMode` and `updateCallSettings` accepts it. Follow the pattern of existing fields. Add clamping/validation if needed (enum values only).

- [ ] **Step 6: Generate and apply migration**

Run: `bun run migrate:generate && bun run migrate`

- [ ] **Step 7: Run typecheck and build**

Run: `bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/server/db/ src/shared/schemas/ src/server/types.ts src/server/services/settings.ts src/client/lib/api.ts
git commit -m "feat: add voicemailMode setting (auto/always/never)"
```

---

## Task 3: Add handleUnavailable() to Adapter Interface + All Implementations

**Files:**
- Modify: `src/server/telephony/adapter.ts`
- Modify: `src/server/telephony/twilio.ts`, `plivo.ts`, `vonage.ts`, `asterisk.ts`, `test.ts`
- Modify: `src/shared/voice-prompts.ts`

- [ ] **Step 1: Add unavailableMessage prompt**

In `src/shared/voice-prompts.ts`, add a new entry to `VOICE_PROMPTS`:

```ts
unavailableMessage: {
  en: 'We are sorry, no one is available to take your call at this time. Please try again later. Goodbye.',
  es: 'Lo sentimos, no hay nadie disponible para atender su llamada en este momento. Por favor intente más tarde. Adiós.',
  zh: '抱歉，目前没有人可以接听您的电话。请稍后再试。再见。',
  tl: 'Paumanhin, walang available na sumagot sa iyong tawag sa ngayon. Pakisubukan muli mamaya. Paalam.',
  vi: 'Xin lỗi, hiện không có ai sẵn sàng nhận cuộc gọi của bạn. Vui lòng thử lại sau. Tạm biệt.',
  ar: 'نأسف، لا يوجد أحد متاح للرد على مكالمتك في الوقت الحالي. يرجى المحاولة مرة أخرى لاحقاً. مع السلامة.',
  fr: 'Désolé, personne n\'est disponible pour prendre votre appel pour le moment. Veuillez réessayer plus tard. Au revoir.',
  ht: 'Nou regrèt, pa gen moun disponib pou reponn apèl ou a kounye a. Tanpri eseye ankò pita. Orevwa.',
  ko: '죄송합니다. 현재 전화를 받을 수 있는 사람이 없습니다. 나중에 다시 시도해 주세요. 안녕히 계세요.',
  ru: 'Извините, сейчас никто не может ответить на ваш звонок. Пожалуйста, перезвоните позже. До свидания.',
  hi: 'क्षमा करें, इस समय आपकी कॉल लेने के लिए कोई उपलब्ध नहीं है। कृपया बाद में पुनः प्रयास करें। अलविदा।',
  pt: 'Desculpe, não há ninguém disponível para atender sua ligação no momento. Por favor, tente novamente mais tarde. Adeus.',
  de: 'Es tut uns leid, im Moment ist niemand erreichbar. Bitte versuchen Sie es später erneut. Auf Wiederhören.',
},
```

- [ ] **Step 2: Add handleUnavailable to adapter interface**

In `src/server/telephony/adapter.ts`, add after `handleVoicemailComplete`:

```ts
/**
 * Play an "unavailable" message and hang up.
 * Used when voicemailMode is 'never' and nobody is available.
 */
handleUnavailable(lang: string, audioUrls?: AudioUrlMap): TelephonyResponse
```

`AudioUrlMap` is already defined as `export type AudioUrlMap = Record<string, string>` at line 231 of adapter.ts — use it directly.

**SignalWire** (`signalwire.ts`) extends `TwilioAdapter` and inherits `handleUnavailable` — no changes needed. Verify inheritance after implementation.

- [ ] **Step 3: Implement on all adapters**

Each adapter already has a `sayOrPlay` or `speak` helper. Follow the pattern used in `handleVoicemailComplete` (which says a thank-you message and hangs up):

**Twilio** (`twilio.ts`): Use `sayOrPlay` + `<Hangup/>`
**Plivo** (`plivo.ts`): Use XML `<Speak>` + `<Hangup/>`
**Vonage** (`vonage.ts`): Use NCCO `talk` action
**Asterisk** (`asterisk.ts`): Use `speak` + `{ action: 'hangup' }`
**TestAdapter** (`test.ts`): Return fixed test response

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/telephony/ src/shared/voice-prompts.ts
git commit -m "feat: add handleUnavailable() adapter method and unavailableMessage prompt"
```

---

## Task 4: Voicemail-Only Mode Routing Logic

**Files:**
- Modify: `src/server/routes/telephony.ts`
- Test: `tests/api/voicemail-mode.spec.ts` (new)

This is the core routing change. In the `/language-selected` handler, after the spam check and before `startParallelRinging`, check voicemail mode.

- [ ] **Step 1: Write test for voicemail-only routing**

Create `tests/api/voicemail-mode.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'
import { ADMIN_NSEC, resetTestState } from '../helpers'

test.describe('Voicemail mode routing', () => {
  let request: ReturnType<typeof createAuthedRequestFromNsec>

  test.beforeAll(async ({ request: rawReq }) => {
    request = createAuthedRequestFromNsec(rawReq, ADMIN_NSEC)
    await resetTestState(rawReq)
  })

  test('voicemailMode=always skips queue and returns voicemail TwiML', async ({ request: rawReq }) => {
    // Set voicemail mode to always
    await request.patch('/api/settings/call', {
      data: { voicemailMode: 'always' },
    })

    // Simulate language-selected webhook
    const res = await rawReq.post('/telephony/language-selected?auto=1&callSid=VM_ALWAYS_TEST')
    expect(res.status()).toBeLessThan(500)
    const body = await res.text()
    // Should contain Record verb (voicemail), not Enqueue
    expect(body).toContain('Record')
    expect(body).not.toContain('Enqueue')
  })

  test('voicemailMode=never with no volunteers returns unavailable message', async ({ request: rawReq }) => {
    await request.patch('/api/settings/call', {
      data: { voicemailMode: 'never' },
    })

    // With no shifts/fallback configured, should get unavailable message
    const res = await rawReq.post('/telephony/language-selected?auto=1&callSid=VM_NEVER_TEST')
    expect(res.status()).toBeLessThan(500)
    const body = await res.text()
    // Should NOT contain Record (no voicemail) or Enqueue (no queue)
    expect(body).not.toContain('Record')
    expect(body).not.toContain('Enqueue')
  })
})
```

Adapt to match actual TwiML patterns from the test adapter. The test adapter may return JSON instead of XML.

- [ ] **Step 2: Extract voicemail mode routing helper**

Create a helper function to avoid duplicating availability checks. Add it near the top of telephony.ts (or in a separate util):

```ts
async function checkVoicemailMode(
  services: Services,
  hubId: string | undefined
): Promise<{ mode: 'auto' | 'always' | 'never'; hasAvailableVolunteers: boolean; callSettings: CallSettings }> {
  const callSettings = await services.settings.getCallSettings(hubId)
  const mode = callSettings.voicemailMode ?? 'auto'

  if (mode === 'always') {
    return { mode, hasAvailableVolunteers: false, callSettings }
  }

  // For auto and never: compute availability once
  let onShift = await services.shifts.getEffectiveVolunteers(hubId)
  if (onShift.length === 0) {
    onShift = await services.settings.getFallbackGroup(hubId)
  }

  return { mode, hasAvailableVolunteers: onShift.length > 0, callSettings }
}
```

- [ ] **Step 3: Implement voicemail-only routing in /language-selected**

In the `/language-selected` handler, replace lines 204-213. The `handleIncomingCall` call at line 193 is **pure TwiML generation** (verified: no DB writes or state mutations) — safe to call and discard:

```ts
if (!rateLimited && !spamSettings.voiceCaptchaEnabled) {
  const { mode, hasAvailableVolunteers, callSettings } = await checkVoicemailMode(services, hubId)

  if (mode === 'always' || (mode === 'auto' && !hasAvailableVolunteers)) {
    // Skip queue — go straight to voicemail
    const audioUrls = await buildAudioUrlMap(services.settings, new URL(c.req.url).origin, hubId)
    const vmResponse = await adapter.handleVoicemail({
      callSid,
      callerLanguage,
      callbackUrl: new URL(c.req.url).origin,
      audioUrls,
      maxRecordingSeconds: callSettings.voicemailMaxSeconds,
      hubId,
    })
    return telephonyResponse(vmResponse)
  }

  if (mode === 'never' && !hasAvailableVolunteers) {
    const audioUrls = await buildAudioUrlMap(services.settings, new URL(c.req.url).origin, hubId)
    return telephonyResponse(adapter.handleUnavailable(callerLanguage, audioUrls))
  }

  // Normal flow — ring volunteers
  const origin = new URL(c.req.url).origin
  console.log(
    `[telephony] /language-selected starting parallel ringing callSid=${callSid} origin=${origin} hub=${hubId || 'global'}`
  )
  startParallelRinging(callSid, callerNumber, origin, env, services, hubId).catch((err) =>
    console.error('[background]', err)
  )
}
```

**Rate-limited callers** bypass voicemail mode entirely (they get the rate-limited response from `handleIncomingCall`). This is correct — spam callers should not reach voicemail.

- [ ] **Step 4: Add voicemail mode check to /captcha handler**

The `/captcha` handler (around line 261) also calls `startParallelRinging` on CAPTCHA success. Without a voicemail mode check, `voicemailMode: 'always'` would be bypassed when CAPTCHA is enabled. Add the same check:

```ts
if (match) {
  const { mode, hasAvailableVolunteers, callSettings } = await checkVoicemailMode(services, hubId)

  if (mode === 'always' || (mode === 'auto' && !hasAvailableVolunteers)) {
    const audioUrls = await buildAudioUrlMap(services.settings, new URL(c.req.url).origin, hubId)
    const vmResponse = await adapter.handleVoicemail({
      callSid,
      callerLanguage: callerLang,
      callbackUrl: new URL(c.req.url).origin,
      audioUrls,
      maxRecordingSeconds: callSettings.voicemailMaxSeconds,
      hubId,
    })
    return telephonyResponse(vmResponse)
  }

  if (mode === 'never' && !hasAvailableVolunteers) {
    const audioUrls = await buildAudioUrlMap(services.settings, new URL(c.req.url).origin, hubId)
    return telephonyResponse(adapter.handleUnavailable(callerLang, audioUrls))
  }

  const origin = new URL(c.req.url).origin
  startParallelRinging(callSid, callerNumber, origin, env, services, hubId).catch((err) =>
    console.error('[background]', err)
  )
}
```

- [ ] **Step 5: Switch encryption recipients to voicemail:listen permission**

In the `/voicemail-recording` handler, the Phase 1 code filters admin pubkeys by role IDs. Now that voicemail permissions exist, switch to permission-based querying. Replace the role-based filter:

```ts
// OLD (Phase 1):
const adminPubkeys = allVolunteers
  .filter((v) => v.roles.some((r: string) => r === 'role-hub-admin' || r === 'role-super-admin'))
  .map((v) => v.pubkey)
```

With:

```ts
// NEW (Phase 2): query by voicemail:listen permission
import { resolvePermissions, permissionGranted } from '@shared/permissions'
// Load role definitions from DB
const roleDefs = await services.identity.getRoles()
const adminPubkeys = allVolunteers
  .filter((v) => {
    const perms = resolvePermissions(v.roles, roleDefs)
    return permissionGranted(perms, 'voicemail:listen')
  })
  .map((v) => v.pubkey)
```

Check that `services.identity.getRoles()` exists — if not, use `services.settings.getRoles()` or load from DB directly. The function must return the `Role[]` array for permission resolution.

- [ ] **Step 3: Run tests**

Run: `bunx playwright test tests/api/voicemail-mode.spec.ts`

- [ ] **Step 4: Run typecheck and build**

Run: `bun run typecheck && bun run build`

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/telephony.ts tests/api/voicemail-mode.spec.ts
git commit -m "feat: implement voicemail-only mode routing (auto/always/never)"
```

---

## Task 5: Voicemail Mode Settings UI

**Files:**
- Modify: `src/client/components/admin-settings/call-settings-section.tsx`
- Modify: `src/client/locales/en.json` (and other locale files for i18n)

- [ ] **Step 1: Add voicemail mode selector to CallSettingsSection**

In `src/client/components/admin-settings/call-settings-section.tsx`, add a `<Select>` component (from shadcn/ui) for `voicemailMode`. Place it before the existing queue timeout field:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Inside the grid, add:
<div className="space-y-2 sm:col-span-2">
  <Label>{t('callSettings.voicemailMode')}</Label>
  <p className="text-xs text-muted-foreground">
    {t('callSettings.voicemailModeDescription')}
  </p>
  <Select
    value={settings.voicemailMode}
    onValueChange={async (val) => {
      try {
        const res = await updateCallSettings({ voicemailMode: val as CallSettings['voicemailMode'] })
        onChange(res)
      } catch {
        toast(t('common.error'), 'error')
      }
    }}
  >
    <SelectTrigger className="w-full">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="auto">{t('callSettings.voicemailModeAuto')}</SelectItem>
      <SelectItem value="always">{t('callSettings.voicemailModeAlways')}</SelectItem>
      <SelectItem value="never">{t('callSettings.voicemailModeNever')}</SelectItem>
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 2: Add i18n keys**

In `src/client/locales/en.json`, add:

```json
"callSettings.voicemailMode": "Voicemail Mode",
"callSettings.voicemailModeDescription": "Controls when callers are sent to voicemail",
"callSettings.voicemailModeAuto": "Auto — voicemail when no one is available",
"callSettings.voicemailModeAlways": "Always — every call goes to voicemail",
"callSettings.voicemailModeNever": "Never — hang up if no one is available"
```

Add equivalent keys in other locale files (at minimum `es.json` for Spanish).

- [ ] **Step 3: Add voicemailRetentionDays UI placeholder**

Per the spec, add the `voicemailRetentionDays` setting to the UI with a "(purge job not yet active)" indicator. This is a read-only display for now:

```tsx
<div className="space-y-2">
  <Label>{t('callSettings.retentionDays')}</Label>
  <p className="text-xs text-muted-foreground">
    {t('callSettings.retentionDaysDescription')}
  </p>
  <Input
    type="number"
    value={settings.voicemailRetentionDays ?? ''}
    placeholder="∞"
    disabled
  />
  <p className="text-xs text-amber-600">{t('callSettings.retentionNotYetActive')}</p>
</div>
```

`voicemailRetentionDays` was added to the DB schema, Zod schema, and type definitions in Task 2. The settings service should already return it. If it doesn't render correctly, verify it's wired in `getCallSettings` / `updateCallSettings`.

- [ ] **Step 4: Run typecheck and build**

Run: `bun run typecheck && bun run build`

- [ ] **Step 5: Commit**

```bash
git add src/client/
git commit -m "feat: add voicemail mode selector and retention display to settings UI"
```

---

## Task 6: Final Verification

- [ ] **Step 1: Run typecheck**: `bun run typecheck`
- [ ] **Step 2: Run build**: `bun run build`
- [ ] **Step 3: Run unit tests**: `bun run test:unit`
- [ ] **Step 4: Run API tests**: `bun run test:api`
- [ ] **Step 5: Commit any fixes**
