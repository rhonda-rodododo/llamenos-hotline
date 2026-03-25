# Fix Remaining 38 UI E2E Test Failures

**Date:** 2026-03-25
**Status:** Partially complete — 81 → 27 failures remaining
**Context:** API tests are at 0 failures (263 passed). UI tests went from 81 → 27 (407 passed). Batches 1, 4, and most of 8 are done. Batches 2, 5, 6 partially done. Reports (11) and WebAuthn CDP (3) are the stubborn remaining clusters.

---

## Batch 1: Toast Accumulation (4 fixes → report-types.spec.ts)

**Root cause:** Success toasts from previous operations linger (4s auto-dismiss), causing `getByText(/success/i)` to match multiple toasts (strict mode violation).

**Files:** `tests/ui/report-types.spec.ts`
**Failing:** Lines 100, 145, 202, 220 (serial cascade)

**Fix:**
- [ ] In `createReportType()` helper (line 47), change `page.getByText(/success/i)` to `page.getByText(/success/i).last()` to target the most recent toast
- [ ] Apply same `.last()` pattern to any other toast assertions in this file
- [ ] Verify all 4 tests pass in isolation and in full suite

**Estimated scope:** Small — 1 file, ~3 line changes

---

## Batch 2: Reports E2EE Timing (8 fixes → reports.spec.ts)

**Root cause:** Report creation involves ECIES encryption which is CPU-intensive. The `createReportViaUI()` helper waits for the report title in the list, but the list refresh (30s polling interval) may not pick up the new report in time.

**Files:** `tests/ui/reports.spec.ts`
**Failing:** Lines 135, 149, 161, 176, 196, 248, 260, 318 (serial cascade from 135)

**Fix:**
- [ ] After submit in `createReportViaUI()`, trigger an immediate list refresh instead of waiting for polling — either click a refresh button or navigate away and back to force reload
- [ ] Increase timeout for report title visibility from 30s to 45s as a safety margin
- [ ] Add explicit `page.waitForResponse` for the report creation API call to confirm server accepted it before checking the list
- [ ] In `selectReport()`, add `.first()` or more specific selector to avoid matching report title text in multiple places
- [ ] Verify the entire serial chain passes

**Estimated scope:** Medium — 1 file, helper function rewrites

---

## Batch 3: Session Expiry During Custom Fields (3 fixes → notes-custom-fields.spec.ts)

**Root cause:** API calls during custom field operations return 401, triggering the "Session Expired" modal. The modal blocks UI interactions and the test handler can't dismiss it fast enough.

**Files:** `tests/ui/notes-custom-fields.spec.ts`, potentially `tests/helpers/index.ts`
**Failing:** Lines 107, 180, 206 (serial cascade)

**Fix:**
- [ ] Investigate why the auth token expires during these tests — the Schnorr signature token may have too tight a validity window
- [ ] Check if the `createCustomTextField()` helper's save button click triggers requests that race with auth token expiry
- [ ] If auth token issue, increase token validity window in test env or re-auth before each operation
- [ ] Alternatively, make the session-expired handler more robust: reconnect automatically and retry the failed operation
- [ ] Verify all 3 tests pass

**Estimated scope:** Medium — requires understanding auth token lifecycle in tests

---

## Batch 4: WebAuthn Collapsible Animation (3 fixes → webauthn.spec.ts)

**Root cause:** The passkeys section uses a Radix Collapsible with a 200ms animation. After clicking to expand, the test tries to interact with elements before the animation completes and content is fully interactive.

**Files:** `tests/ui/webauthn.spec.ts`
**Failing:** Lines 94, 191, 288 (all depend on `openPasskeysSection`)

**Fix:**
- [ ] Verify `openPasskeysSection()` waits for `passkey-label-input` to be visible (already added in previous session)
- [ ] If still failing, add `waitForTimeout(300)` after section expansion AND wait for the input to be `enabled` (not just visible)
- [ ] For line 94 (toBeDisabled), verify the register button's disabled state timing — it should be disabled when label is empty
- [ ] Check if `webauthnRegistering` state interferes with the disabled check
- [ ] Verify all 3 tests pass in serial

**Estimated scope:** Small — 1 file, timing adjustments

---

## Batch 5: Invite Onboarding Flow (2 fixes → invite-onboarding.spec.ts)

**Root cause:** The "Invite Volunteer" button click times out. Since we changed the selector to `/invite volunteer/i`, this should now work — but the invite creation flow itself may have a timing issue where the form or the onboarding page doesn't load in time.

**Files:** `tests/ui/invite-onboarding.spec.ts`
**Failing:** Lines 7, 100

**Fix:**
- [ ] Verify the `/invite volunteer/i` selector matches the button
- [ ] Check if the invite form opens after clicking — add explicit `waitFor` for the form dialog
- [ ] For line 7 (full onboarding flow), verify the onboarding page at `/onboarding?code=...` loads and renders the form
- [ ] For line 100 (revoke), verify the pending invites list shows the newly created invite
- [ ] Add appropriate timeouts for E2EE key operations during onboarding

**Estimated scope:** Small-Medium — 1 file, timing and selector adjustments

---

## Batch 6: File Field Custom Type (2 fixes → file-field.spec.ts)

**Root cause:** Line 100 "file custom field shows in note form" — after adding the file option to the dropdown, the test may still fail due to selectOption timing. Line 225 "maxFileSize validation" — similar selector timing issue.

**Files:** `tests/ui/file-field.spec.ts`
**Failing:** Lines 100, 225

**Fix:**
- [ ] For line 100: verify `selectOption('file')` succeeds now that the option exists; add explicit wait for the dropdown to be populated
- [ ] For line 225: check if the file field dropzone's validation error message matches the test's expected text
- [ ] Both may need `waitForTimeout` after `selectOption` to let React re-render

**Estimated scope:** Small — 1 file, timing adjustments

---

## Batch 7: GDPR Flow Timing (2 fixes → gdpr.spec.ts)

**Root cause:** Line 72 — admin navigates to settings for data export but the settings page element isn't visible. Line 118 — volunteer erasure request times out at 30s, likely due to the full flow (create volunteer → login → request erasure → cancel) being too slow.

**Files:** `tests/ui/gdpr.spec.ts`
**Failing:** Lines 72, 118

**Fix:**
- [ ] Line 72: check if the "Data Export" section needs to be scrolled into view or expanded (collapsible section)
- [ ] Line 118: increase test timeout from 30s to 60s for this test, or optimize the flow by using API helpers instead of UI for volunteer creation
- [ ] Both: verify selectors match current component structure

**Estimated scope:** Small — 1 file

---

## Batch 8: Singleton Fixes (11 individual tests)

Each of these is a single failure in its own file. Fix individually:

### 8a. blast-sending.spec.ts:16 — Composer UI timing
- [ ] After saving a blast, add explicit wait for list refresh before asserting blast name visibility

### 8b. blasts.spec.ts:154 — Delete button visibility
- [ ] Verify delete button only shows for draft blasts; wait for detail panel to fully render before clicking

### 8c. call-flow.spec.ts:189 — Active call panel
- [ ] Check if the simulated call reaches the volunteer properly; verify active call panel selector matches current component

### 8d. call-spam.spec.ts:79 — Ban rejection response format
- [ ] Check what the TestAdapter returns for banned numbers; update the regex to match the actual rejection XML/format

### 8e. dashboard-analytics.spec.ts:71 — Period toggle
- [ ] Wait for chart content to be visible before clicking toggle buttons; the 7d/30d buttons may not render until data loads

### 8f. hub-access-control.spec.ts:41 — Edit dialog
- [ ] Add timeout to the `hub-access-control` testid visibility check; the dialog may need more time to render

### 8g. invite-delivery.spec.ts:92 — "Not sent" status
- [ ] After invite creation, verify the pending invite card renders with "Not sent" text; may need to scroll to the invite in the list

### 8h. multi-hub.spec.ts:43 — Archive hub via UI
- [ ] Check if the archive button selector matches the current component; the hub list item may have changed structure

### 8i. pwa-offline.spec.ts:196 — Offline cache
- [ ] Service worker caching may not be populated in test env; verify the test properly waits for SW registration before going offline

### 8j. roles.spec.ts:111 — Role selector dropdown
- [ ] Check if the role combobox/select has the expected aria-label "Change role"; the component may use a different label now

### 8k. voicemail-webhook.spec.ts:18 — Voicemail badge
- [ ] After simulating voicemail, wait for the call record to be updated before navigating to /calls; the badge depends on `hasVoicemail` being true in the fetched data

### 8l. setup-wizard.spec.ts:476 — Provider form
- [ ] Similar to the setup-wizard-provider fixes — check for strict mode violations or renamed elements

### 8m. demo-mode.spec.ts:202 — Demo bans
- [ ] Wait for demo data seeding to complete before navigating to ban list; add `waitForResponse` for the seed API call

### 8n. webauthn-passkeys.spec.ts:42 — Auth check
- [ ] Check expected vs actual status code for the register options endpoint; the endpoint may now return a different status for unauthenticated requests

**Estimated scope:** Medium-Large — 14 files, each needs individual investigation

---

## Implementation Order

1. **Batch 1** (report-types toasts) — smallest, highest confidence fix
2. **Batch 4** (webauthn animation) — small, already partially fixed
3. **Batch 6** (file-field timing) — small
4. **Batch 7** (GDPR timing) — small
5. **Batch 5** (invite-onboarding) — small-medium
6. **Batch 2** (reports E2EE) — medium, most impactful (8 tests)
7. **Batch 3** (session expiry) — medium, requires auth investigation
8. **Batch 8** (singletons) — large, each independent

## Success Criteria

- All 38 tests pass in parallel (3 workers)
- No regressions in currently passing tests (387 + 263 API)
- No workarounds that weaken app code
