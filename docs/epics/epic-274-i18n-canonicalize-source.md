# Epic 274: Canonicalize i18n Source of Truth

## Problem

`packages/i18n/locales/en.json` has grown with two incompatible conventions:

1. **Desktop** uses nested camelCase objects accessed via i18next dot notation: `t('dashboard.activeCalls')`
2. **Mobile** uses flat snake_case keys: `NSLocalizedString("dashboard_active_calls")` / `R.string.dashboard_active_calls`

This created 52 within-object duplicates (e.g., `dashboard.activeCalls` AND `dashboard.active_calls` in the same object), 254 groups of duplicate values, and 1,770 total flattened keys where ~800 are camelCase keys unused by mobile.

The codegen (`i18n-codegen.ts`) just joins nested keys with `_` without case conversion, so `auditLog.actor` → `auditLog_actor` (mixed case, not usable by mobile).

## Solution

1. Standardize en.json on **camelCase nested objects** (i18next convention)
2. Remove snake_case duplicates from nested objects
3. Move top-level flat snake_case-only keys into appropriate nested objects as camelCase
4. Update codegen to convert camelCase → snake_case during mobile flattening
5. Update desktop `t()` calls for any relocated keys
6. Propagate changes to all 13 locale files
7. Regenerate all platform output

## Scope

**Files to modify:**
- `packages/i18n/locales/*.json` (13 locale files)
- `packages/i18n/tools/i18n-codegen.ts`
- `packages/i18n/tools/validate-strings.ts`
- `src/client/**/*.{ts,tsx}` (desktop `t()` calls for relocated keys)

**Files generated (not manually edited):**
- `packages/i18n/generated/ios/**/*.strings`
- `packages/i18n/generated/android/**/strings.xml`
- `apps/ios/Resources/Localizable/**/*.strings`
- `apps/android/app/src/main/res/**/strings.xml`
- `apps/android/app/src/main/java/org/llamenos/i18n/I18n.kt`

## Tasks

### Task 1: Update codegen to convert camelCase → snake_case

**Files:**
- Modify: `packages/i18n/tools/i18n-codegen.ts:41-52`
- Modify: `packages/i18n/tools/validate-strings.ts:38-49`

**Step 1: Add camelToSnake helper to codegen**

In `i18n-codegen.ts`, add before `flattenKeys`:

```typescript
/** Convert camelCase to snake_case: "activeCalls" → "active_calls" */
function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}
```

**Step 2: Create separate flatten functions for desktop vs mobile**

Replace the existing `flattenKeys` with two functions:

```typescript
/** Flatten for mobile: converts camelCase keys to snake_case, joins with underscore */
function flattenKeysSnake(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = camelToSnake(key)
    const fullKey = prefix ? `${prefix}_${snakeKey}` : snakeKey
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenKeysSnake(value as Record<string, unknown>, fullKey))
    } else if (typeof value === 'string') {
      result[fullKey] = value
    }
  }
  return result
}
```

**Step 3: Update codegen main() to use flattenKeysSnake**

Replace the `flattenKeys` call in `main()` (line 131) and the loop (line 141) with `flattenKeysSnake`.

**Step 4: Update validate-strings.ts to match**

Add the same `camelToSnake` function and update `flattenKeysUnderscore` to use it (rename to `flattenKeysSnake`). The dotted version for desktop stays unchanged.

**Step 5: Run codegen and verify**

```bash
bun run i18n:codegen
```

Expected: generates mobile output with all-snake_case keys. Desktop output unchanged.

**Step 6: Commit**

```bash
git add packages/i18n/tools/i18n-codegen.ts packages/i18n/tools/validate-strings.ts
git commit -m "feat(i18n): codegen converts camelCase to snake_case for mobile output"
```

---

### Task 2: Remove within-object snake_case duplicates from en.json

**Files:**
- Modify: `packages/i18n/locales/en.json`

These 52 duplicates exist in `dashboard`, `help`, `pin`, `settings`, `shifts` objects where both `camelCase` and `snake_case` versions of the same key coexist.

**Step 1: Remove snake_case duplicates from `dashboard` object**

Remove these keys (keeping the camelCase versions):
- `active_calls` (duplicate of `activeCalls`)
- `calls_today` (duplicate of `callsToday`)
- `end_break` (duplicate of `endBreak`)
- `go_on_break` (duplicate of `goOnBreak` — note: different values! Keep camelCase value "Take a Break")
- `no_active_calls` (duplicate of `noActiveCalls`)
- `on_break` (duplicate of `onBreak`)
- `on_shift` (duplicate of `onShift`)
- `off_shift` (duplicate of `offShift` — add `offShift` if missing, keeping value "Off Shift")

Keep these snake_case keys that have NO camelCase equivalent (they are mobile-only):
- `error_break`, `error_clock_in`, `error_clock_out`, `error_refresh`
- `no_notes`, `no_recent_notes`, `recent_notes`
- `shift_status`, `view_all_notes`, `view_calls`

Convert these mobile-only snake_case keys to camelCase:
- `error_break` → `errorBreak`
- `error_clock_in` → `errorClockIn`
- `error_clock_out` → `errorClockOut`
- `error_refresh` → `errorRefresh`
- `no_notes` → `noNotes`
- `no_recent_notes` → `noRecentNotes`
- `recent_notes` → `recentNotes`
- `shift_status` → `shiftStatus`
- `view_all_notes` → `viewAllNotes`
- `view_calls` → `viewCalls`

**Step 2: Remove snake_case duplicates from `help` object**

Remove 40+ snake_case keys that duplicate camelCase versions. For keys where values DIFFER, keep the more detailed/mobile-specific value in the camelCase version.

Key groups to deduplicate:
- `admin_guide` → keep `adminGuide`
- `admin_intro` → keep `adminIntro` (use mobile value if more appropriate)
- `admin_tip1`–`admin_tip5` → keep `adminTip1`–`adminTip5`
- `faq_admin` → keep `faqAdmin`
- `faq_break_a/q` → keep `faqBreakA/Q`
- `faq_calls` → keep `faqCalls`
- `faq_encrypt_a/q` → keep `faqEncryptA/Q`
- `faq_export_a/q` → keep `faqExportA/Q`
- `faq_getting_started` → keep `faqGettingStarted`
- `faq_invite_a/q` → keep `faqInviteA/Q`
- `faq_key_a/q` → keep `faqKeyA/Q`
- `faq_login_a/q` → keep `faqLoginA/Q`
- `faq_notes` → keep `faqNotes`
- `faq_ring_a/q` → keep `faqRingA/Q`
- `faq_shifts_a/q` → keep `faqShiftsA/Q`
- `faq_spam_a/q` → keep `faqSpamA/Q`
- `faq_title` → keep `faqTitle`
- `sec_auth` → keep `secAuth`
- `sec_notes` → keep `secNotes`
- `sec_reports` → keep `secReports`
- `sec_sessions` → keep `secSessions`
- `volunteer_guide` → keep `volunteerGuide`
- `volunteer_intro` → keep `volunteerIntro`
- `volunteer_tip1`–`volunteer_tip5` → keep `volunteerTip1`–`volunteerTip5`

Also convert mobile-only snake_case keys in help to camelCase:
- `admin_audit_detail/title` → `adminAuditDetail/Title`
- `admin_guide_header` → `adminGuideHeader`
- `admin_reports_detail/title` → `adminReportsDetail/Title`
- `admin_shifts_detail/title` → `adminShiftsDetail/Title`
- `admin_spam_detail/title` → `adminSpamDetail/Title`
- `admin_volunteers_detail/title` → `adminVolunteersDetail/Title`
- `faq_admin_a1/a2/a3/q1/q2/q3` → `faqAdminA1/A2/A3/Q1/Q2/Q3`
- `faq_admin_header` → `faqAdminHeader`
- `faq_calls_a1/a2/q1/q2` → `faqCallsA1/A2/Q1/Q2`
- `faq_calls_header` → `faqCallsHeader`
- `faq_getting_started_header` → `faqGettingStartedHeader`
- `faq_gs_a1/a2/a3/q1/q2/q3` → `faqGsA1/A2/A3/Q1/Q2/Q3`
- `faq_notes_a1/a2/q1/q2` → `faqNotesA1/A2/Q1/Q2`
- `faq_notes_header` → `faqNotesHeader`
- `security_auth/header/notes/reports/sessions` → keep as-is (already camelCase-compatible: `securityAuth`, etc.)
- `vol_calls_detail/title` → `volCallsDetail/Title`
- `vol_encryption_detail/title` → `volEncryptionDetail/Title`
- `vol_notes_detail/title` → `volNotesDetail/Title`
- `vol_safety_detail/title` → `volSafetyDetail/Title`
- `vol_shift_detail/title` → `volShiftDetail/Title`
- `volunteer_guide_header` → `volunteerGuideHeader`

**Step 3: Remove snake_case duplicates from `pin` object**

- `confirm_title` → keep `confirmTitle`
- `unlock_title` → keep `unlockTitle`

Convert mobile-only snake_case keys to camelCase:
- `confirm_subtitle` → `confirmSubtitle`
- `set_encrypting` → `setEncrypting`
- `set_subtitle` → `setSubtitle`
- `set_title` → `setTitle`
- `unlock_attempts` → `unlockAttempts`
- `unlock_subtitle` → `unlockSubtitle`
- `unlock_verifying` → `unlockVerifying`
- `lockout_remaining` → `lockoutRemaining`
- `dot_empty` → `dotEmpty`
- `dot_filled` → `dotFilled`

**Step 4: Remove snake_case duplicates from `settings` object**

- `not_configured` → keep `notConfigured`

Convert all snake_case keys to camelCase in the settings object (there are many: `about_header`, `actions_header`, `auto_lock`, `call_sounds`, `connection_header`, `copy_npub`, etc.).

**Step 5: Remove snake_case duplicates from `shifts` object**

- `off_shift` → keep `offShift`
- `on_shift` → keep `onShift` (already exists)

Convert mobile-only snake_case keys:
- `active_calls` → `activeCalls`
- `clock_in` → `clockIn`
- `clock_out` → `clockOut`
- `clock_out_confirm` → `clockOutConfirm`
- `clock_out_title` → `clockOutTitle`
- `clocked_in` → `clockedIn`
- `clocked_out` → `clockedOut`
- `empty_scheduled` → `emptyScheduled`
- `empty_subtitle` → `emptySubtitle`
- `empty_title` → `emptyTitle`
- `none_scheduled` → `noneScheduled`
- `sign_up` → `signUp`
- `signed_up` → `signedUp`
- `weekly_schedule` → `weeklySchedule`
- `call_badge` → keep under `notes` where it currently lives

**Step 6: Commit**

```bash
git add packages/i18n/locales/en.json
git commit -m "refactor(i18n): remove 52 within-object snake_case duplicate keys from en.json"
```

---

### Task 3: Move top-level flat keys into nested objects

**Files:**
- Modify: `packages/i18n/locales/en.json`

Top-level flat snake_case keys that should move into existing nested objects. Group by target object:

**Into `device_link` → rename to `deviceLink` (merge both existing objects):**
- Merge existing `deviceLink` (29 keys, camelCase, desktop) and `device_link` (6 keys, snake_case, mobile) into one `deviceLink` object
- Move flat keys: `device_link_camera_permission`, `device_link_complete`, `device_link_connecting`, `device_link_importing`, `device_link_scan`, `device_link_step_import`, `device_link_step_scan`, `device_link_step_verify`, `device_link_verify`, `device_link_verify_subtitle`
- Convert to camelCase: `cameraPermission`, `complete`, `connecting`, `importing`, `scan`, `stepImport`, `stepScan`, `stepVerify`, `verify`, `verifySubtitle`

**Into `panicWipe` (merge with `panic_wipe`):**
- Merge `panicWipe.wiping` with `panic_wipe.confirm` and `panic_wipe.title`
- Move flat `panic_wipe_message` in as `message`
- Result: single `panicWipe` object with `wiping`, `confirm`, `title`, `message`

**Into existing nested objects (convert to camelCase):**
- `blast_create` → `blasts.create` (but `blasts` already has `create_first`)
- `blast_message_hint` → `blasts.messageHint`
- `blast_recipient_count` → `blasts.recipientCount`
- `blast_recipient_count_one` → `blasts.recipientCountOne`
- `blast_recipients` → `blasts.recipientsLabel`
- `blast_schedule` → `blasts.schedule`
- `blast_schedule_later` → `blasts.scheduleLater`
- `blast_select_all` → `blasts.selectAll`
- `blast_send_now` → move value into `blasts.sendNow` (already exists)

And so on for all other top-level flat keys. The pattern is consistent:
- Identify the prefix (e.g., `shift_`, `volunteer_`, `report_`, `note_`, `call_history_`, etc.)
- Move into the corresponding nested object
- Convert the suffix to camelCase

**Important: some top-level flat keys are unique to mobile and have no nested equivalent.** These MUST be moved into nested objects so codegen produces them correctly.

**Step 1: Write a migration script**

Create `packages/i18n/tools/migrate-keys.ts` — a one-time script that:
1. Reads en.json
2. Moves flat keys into nested objects with camelCase conversion
3. Removes the `device_link` and `panic_wipe` objects (merged into camelCase versions)
4. Writes the result sorted alphabetically
5. Validates no keys were lost (flat key count before == after)

**Step 2: Run migration script**

```bash
bun run packages/i18n/tools/migrate-keys.ts
```

**Step 3: Manually verify en.json structure**

Spot-check that:
- No top-level flat keys remain that have an obvious nested parent
- All nested objects use camelCase keys
- No values were lost or corrupted

**Step 4: Propagate to all locale files**

Run the migration script against all 13 locale files (or write it to process all).

**Step 5: Delete migration script**

```bash
rm packages/i18n/tools/migrate-keys.ts
```

**Step 6: Commit**

```bash
git add packages/i18n/locales/
git commit -m "refactor(i18n): move flat keys into nested objects, merge duplicate structures"
```

---

### Task 4: Update desktop t() calls for relocated keys

**Files:**
- Modify: `src/client/**/*.{ts,tsx}` (any files referencing relocated keys)

Desktop uses i18next dot notation. Keys that moved from top-level flat to nested need their `t()` calls updated.

**Step 1: Run desktop validation to find broken refs**

```bash
bun run i18n:validate:desktop
```

This will report all `t('key')` calls that no longer match en.json structure.

**Step 2: Fix each broken reference**

For each reported mismatch, update the `t()` call. Examples:
- `t('blast_create')` → `t('blasts.create')` (if moved)
- `t('device_link_title')` → `t('deviceLink.title')` (already existed)

Most desktop code already uses the nested camelCase form, so this should be a small list.

**Step 3: Run validation again**

```bash
bun run i18n:validate:desktop
```

Expected: 0 errors.

**Step 4: Commit**

```bash
git add src/client/
git commit -m "refactor(i18n): update desktop t() calls for relocated keys"
```

---

### Task 5: Regenerate all platform output and validate

**Files:**
- All generated files (iOS .strings, Android strings.xml, I18n.kt)

**Step 1: Run codegen**

```bash
bun run i18n:codegen
```

**Step 2: Verify generated output uses all-snake_case keys**

```bash
# Check for any camelCase in generated iOS strings
grep -P '[a-z][A-Z]' packages/i18n/generated/ios/en.lproj/Localizable.strings | head -5
# Should output nothing
```

```bash
# Check for any camelCase in generated Android strings
grep -P 'name="[^"]*[a-z][A-Z]' packages/i18n/generated/android/values/strings.xml | head -5
# Should output nothing
```

**Step 3: Count keys to verify no loss**

```bash
grep -c '=' packages/i18n/generated/ios/en.lproj/Localizable.strings
# Should be close to original count minus duplicates removed
```

**Step 4: Run all validators**

```bash
bun run i18n:validate:all
```

Expected: desktop passes (we fixed refs in Task 4). iOS and Android will FAIL — their code still references old keys. That's expected and fixed in Epic 275.

**Step 5: Commit generated output**

```bash
git add packages/i18n/generated/ apps/ios/Resources/Localizable/ apps/android/app/src/main/res/
git commit -m "chore(i18n): regenerate all platform strings with snake_case keys"
```

---

### Task 6: Verify desktop builds and tests pass

**Step 1: Typecheck**

```bash
bun run typecheck
```

**Step 2: Build**

```bash
bun run build
```

**Step 3: Run desktop tests**

```bash
bun run test:desktop
```

**Step 4: Commit any fixes**

If any desktop code broke due to key changes, fix and commit.

---

## Acceptance Criteria

- [ ] en.json uses camelCase for ALL nested object keys (zero snake_case keys inside objects)
- [ ] No within-object duplicates remain
- [ ] Codegen produces all-snake_case keys for iOS and Android
- [ ] Desktop `t()` calls all resolve correctly
- [ ] `bun run i18n:validate:desktop` passes with 0 errors
- [ ] Desktop typecheck, build, and tests pass
- [ ] All 13 locale files updated consistently
- [ ] Key count is reduced (duplicates removed) but no unique concepts lost

## Dependencies

- None (this epic can start immediately)
- Epic 275 depends on this epic completing first

## Risks

- Desktop `t()` calls may reference keys via string interpolation (dynamic keys) — validator warns but can't fix these automatically
- Some duplicate values have slightly different text — need manual decision on which to keep
- Migration script must be carefully validated against all 13 locales
