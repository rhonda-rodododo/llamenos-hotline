# Epic 308: In-Call Quick Actions — Ban & Notes

**Status**: COMPLETE (Phase 1 — API + BDD. Phase 2 client UI deferred to per-platform epics)
**Priority**: Medium
**Depends on**: Epic 306 (relay fixes — call events must work for call state tracking)
**Blocks**: None
**Branch**: `desktop`

## Summary

Add "Ban & Hang Up" and "Open Notes" quick-action buttons to the active call UI across all three client platforms. Volunteers should be able to ban a caller and hang up in a single tap, or open a note editor pre-filled with the current call ID, without navigating away from the call screen. Desktop has the call controls component (`WebRtcCallControls`); iOS and Android handle calls via Linphone/CallKit/ConnectionService and need an in-app overlay or post-call sheet.

## Problem Statement

During an active call, volunteers have no quick way to:
1. **Ban the caller** — they must hang up, navigate to the ban list, manually enter the phone number, and add a reason. By then they may forget the number or the caller may call back.
2. **Create a note** — they must hang up, navigate to call history, find the call, then create a note. This loses the context of what just happened.

The backend already supports both operations (`POST /api/bans`, `POST /api/notes` with `callId`). The missing piece is UI that surfaces these actions during or immediately after a call.

**Note**: A ban button already exists in the desktop `ActiveCallPanel` component (`src/client/routes/index.tsx:181-188`) but **is broken** — it calls `addBan({ phone: callerNumber })` directly, but `callerNumber` is always `'[redacted]'` for volunteers (security audit round 6 flagged this). The fix is the server-side `POST /api/calls/:callId/ban` endpoint where the server resolves the actual phone number internally.

## Implementation

### Phase 1: API + Shared Specs

#### Task 1: Combined Ban + Hangup API endpoint

Create a convenience endpoint that bans the caller and ends the call atomically.

**File**: `apps/worker/routes/calls.ts`

```typescript
/**
 * POST /api/calls/:callId/ban
 * Bans the caller and hangs up the call in one operation.
 * Requires: calls:answer (volunteer must be on the call) + bans:report
 */
calls.post('/:callId/ban', requirePermission('bans:report'), async (c) => {
  const callId = c.req.param('callId')
  const body = await c.req.json<{ reason?: string }>()

  // 1. Get call record to extract caller phone
  const callRes = await dos.calls.fetch(new Request(`http://do/calls/${callId}`))
  if (!callRes.ok) return c.json({ error: 'Call not found' }, 404)
  const { call } = await callRes.json() as { call: CallRecord }

  // 2. Verify the volunteer is on this call
  if (call.answeredBy !== c.get('pubkey')) {
    return c.json({ error: 'Not your call' }, 403)
  }

  // 3. Ban the caller
  const banRes = await dos.identity.fetch(new Request('http://do/bans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: call.callerNumber,
      reason: body.reason || 'Banned during active call',
      bannedBy: c.get('pubkey'),
    }),
  }))

  // 4. Hang up the call
  await dos.calls.fetch(new Request(`http://do/calls/${callId}/hangup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkey: c.get('pubkey') }),
  }))

  const ban = banRes.ok ? await banRes.json() : null
  return c.json({ ban, hungUp: true })
})
```

#### Task 2: i18n strings

**File**: `packages/i18n/locales/en.json` (+ propagate to all 13 locales)

```json
{
  "callActions": {
    "banAndHangUp": "Ban & Hang Up",
    "banAndHangUpConfirm": "Ban this caller and end the call?",
    "banReason": "Reason (optional)",
    "openNotes": "Notes",
    "noteForCall": "Note for call {{callId}}",
    "banSuccess": "Caller banned and call ended",
    "banFailed": "Failed to ban caller"
  }
}
```

#### Task 3: Shared BDD Feature File

**File**: `packages/test-specs/features/core/call-actions.feature`

```gherkin
@backend
Feature: In-Call Quick Actions
  Volunteers can ban callers and create notes during active calls
  without navigating away from the call screen.

  Background:
    Given a registered admin "admin1"
    And a registered volunteer "vol1" on the current shift

  @calls @bans
  Scenario: Ban and hang up during active call
    Given volunteer "vol1" is on an active call with caller "+15559876543"
    When volunteer "vol1" bans and hangs up the call
    Then the call status should be "completed"
    And the caller "+15559876543" should be in the ban list
    And the ban reason should be "Banned during active call"

  @calls @bans
  Scenario: Ban and hang up with custom reason
    Given volunteer "vol1" is on an active call with caller "+15559876543"
    When volunteer "vol1" bans and hangs up with reason "Threatening language"
    Then the caller "+15559876543" should be in the ban list
    And the ban reason should be "Threatening language"

  @calls @bans
  Scenario: Cannot ban another volunteer's call
    Given volunteer "vol2" is on an active call
    When volunteer "vol1" tries to ban and hang up that call
    Then the response status should be 403

  @calls @notes
  Scenario: Create note during active call
    Given volunteer "vol1" is on an active call
    When volunteer "vol1" creates a note for the active call
    Then a note should exist linked to that call ID
    And the note author should be "vol1"

  @calls @bans
  Scenario: Banned caller cannot call back
    Given volunteer "vol1" banned caller "+15559876543" during a call
    When an incoming call arrives from "+15559876543"
    Then the call should be rejected with ban message
```

#### Task 4: Backend step definitions

**File**: `tests/steps/backend/call-actions.steps.ts`

### Phase 2: Client Implementation (parallel agents)

#### Desktop (`src/client/`)

**File**: `src/client/components/webrtc-call.tsx`

Add two buttons to `WebRtcCallControls` in the "connected" state:

```tsx
// In the connected controls section, alongside mute and hangup:
<Button
  variant="outline"
  size="sm"
  data-testid="call-open-notes"
  onClick={() => setShowNoteEditor(true)}
>
  <PencilIcon className="h-4 w-4 mr-1" />
  {t('callActions.openNotes')}
</Button>

<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button
      variant="destructive"
      size="sm"
      data-testid="call-ban-hangup"
    >
      <BanIcon className="h-4 w-4 mr-1" />
      {t('callActions.banAndHangUp')}
    </Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{t('callActions.banAndHangUpConfirm')}</AlertDialogTitle>
    </AlertDialogHeader>
    <Input
      placeholder={t('callActions.banReason')}
      data-testid="ban-reason-input"
      value={banReason}
      onChange={e => setBanReason(e.target.value)}
    />
    <AlertDialogFooter>
      <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
      <AlertDialogAction onClick={handleBanAndHangup}>
        {t('callActions.banAndHangUp')}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Add inline note editor (modal/sheet) that opens with `callId` pre-filled, reusing the existing note creation form from the notes page.

**New API function** in `src/client/lib/api.ts`:

```typescript
export async function banAndHangup(callId: string, reason?: string) {
  return request<{ ban: BanEntry; hungUp: boolean }>(
    hp(`/calls/${callId}/ban`),
    { method: 'POST', body: JSON.stringify({ reason }) },
  )
}
```

#### iOS (`apps/ios/`)

Since calls are handled by Linphone SDK + CallKit, the native phone UI is shown during active calls. Add a **post-call action sheet** that appears when the call ends:

**File**: `apps/ios/Sources/Views/Calls/PostCallActionsView.swift` (new)

- Shows after call ends (triggered by `CXCallObserver` delegate or Linphone callback)
- "Ban This Caller" button → confirmation alert → `POST /api/calls/:callId/ban`
- "Add Note" button → opens NoteEditorView with callId pre-filled
- "Dismiss" to skip

**File**: `apps/ios/Sources/Views/Calls/InCallOverlayView.swift` (new)

- Floating overlay during active Linphone call (similar to WhatsApp in-call overlay)
- Compact buttons: Notes, Ban & Hangup
- Uses `WindowGroup` or `UIWindow` overlay above CallKit UI

#### Android (`apps/android/`)

Same approach — Linphone handles the call UI via `ConnectionService`. Add:

**File**: `apps/android/app/src/main/java/org/llamenos/hotline/ui/calls/PostCallActionsSheet.kt` (new)

- `BottomSheetDialogFragment` shown after call ends
- "Ban Caller" + "Add Note" buttons
- Calls `POST /api/calls/:callId/ban`

**File**: `apps/android/app/src/main/java/org/llamenos/hotline/ui/calls/InCallOverlay.kt` (new)

- Bubble overlay during active call (like Android's chat bubbles)
- Quick action buttons for Notes and Ban

### Phase 3: Integration Gate

`bun run test:all`

## Files to Create

| File | Purpose |
|------|---------|
| `packages/test-specs/features/core/call-actions.feature` | BDD scenarios for ban+hangup and in-call notes |
| `tests/steps/backend/call-actions.steps.ts` | Backend step definitions |
| `apps/ios/Sources/Views/Calls/PostCallActionsView.swift` | iOS post-call action sheet |
| `apps/ios/Sources/Views/Calls/InCallOverlayView.swift` | iOS in-call floating overlay |
| `apps/android/app/src/main/java/org/llamenos/hotline/ui/calls/PostCallActionsSheet.kt` | Android post-call bottom sheet |
| `apps/android/app/src/main/java/org/llamenos/hotline/ui/calls/InCallOverlay.kt` | Android in-call bubble overlay |

## Files to Modify

| File | Change |
|------|--------|
| `apps/worker/routes/calls.ts` | Add `POST /api/calls/:callId/ban` endpoint |
| `src/client/components/webrtc-call.tsx` | Add ban+hangup and notes buttons to call controls |
| `src/client/routes/index.tsx` | Fix broken `onBanNumber` to use server-side endpoint instead of client-side `addBan()` |
| `src/client/lib/api.ts` | Add `banAndHangup()` API function |
| `packages/i18n/locales/en.json` | Add callActions strings |
| `packages/i18n/locales/*.json` | Propagate callActions to all 13 locales |

## Testing

### Backend BDD (Phase 1 gate)

- `bun run test:backend:bdd` — 5 scenarios in `call-actions.feature`

### Desktop E2E (Phase 2)

- Playwright test: ban+hangup button visible during active call, creates ban entry
- Playwright test: notes button opens editor with callId pre-filled

### Mobile (Phase 2)

- iOS XCUITest: post-call sheet appears after call ends with ban/notes options
- Android Compose UI Test: post-call bottom sheet with ban/notes options

## Acceptance Criteria & Test Scenarios

- [ ] `POST /api/calls/:callId/ban` bans caller and ends call atomically
  → `packages/test-specs/features/core/call-actions.feature: "Ban and hang up during active call"`
- [ ] Ban with custom reason stores the reason
  → `packages/test-specs/features/core/call-actions.feature: "Ban and hang up with custom reason"`
- [ ] Cannot ban another volunteer's call (403)
  → `packages/test-specs/features/core/call-actions.feature: "Cannot ban another volunteer's call"`
- [ ] Note can be created linked to active call ID
  → `packages/test-specs/features/core/call-actions.feature: "Create note during active call"`
- [ ] Banned caller's next call is rejected
  → `packages/test-specs/features/core/call-actions.feature: "Banned caller cannot call back"`
- [ ] Desktop shows ban+hangup and notes buttons during active call
  → `tests/call-actions.spec.ts: "ban and notes buttons visible during active call"`
- [ ] iOS shows post-call actions after call ends
  → `apps/ios/Tests/PostCallActionsTests.swift`
- [ ] Android shows post-call actions after call ends
  → `apps/android/app/src/androidTest/.../PostCallActionsTest.kt`
- [ ] i18n strings present in all 13 locales
  → `bun run i18n:validate:all`
- [ ] All platform BDD suites pass (`bun run test:all`)
- [ ] Backlog files updated

## Feature Files

| File | Status | Description |
|------|--------|-------------|
| `packages/test-specs/features/core/call-actions.feature` | New | 5 scenarios for ban+hangup and in-call notes |
| `tests/steps/backend/call-actions.steps.ts` | New | Backend step definitions |
| `tests/call-actions.spec.ts` | New (Phase 2) | Desktop Playwright tests |

## Risk Assessment

- **Low risk**: Backend endpoint (Task 1) — combines two existing operations, straightforward
- **Low risk**: Desktop UI (Phase 2) — adding buttons to existing component
- **Medium risk**: iOS in-call overlay — overlaying UI above CallKit requires careful `UIWindow` management; may need to use a notification-style banner instead
- **Medium risk**: Android bubble overlay — requires `SYSTEM_ALERT_WINDOW` permission or notification-based approach; may simplify to post-call sheet only

## Execution

- **Phase 1**: Sequential (API → i18n → feature file → step definitions → gate)
- **Phase 2**: Parallel per-client (Desktop / iOS / Android)
- **Phase 3**: `bun run test:all`
