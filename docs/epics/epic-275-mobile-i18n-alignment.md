# Epic 275: Align Mobile i18n References

## Problem

After Epic 274 canonicalizes en.json and updates codegen to produce snake_case keys from camelCase source, mobile apps need to update their string references to match the new codegen output.

Key changes from Epic 274:
- Keys like `dashboard_activeCalls` → now `dashboard_active_calls` (camelCase converted to snake_case)
- Keys like `auditLog_actor` → now `audit_log_actor` (prefix also converted)
- Flat keys moved into objects: `device_link_title` → `device_link_title` (same, but now generated from `deviceLink.title`)
- Some duplicate keys removed: code referencing them needs to use the surviving key

## Scope

**iOS (406 string references):**
- `apps/ios/Sources/**/*.swift` — all `NSLocalizedString()` calls

**Android (381 string references + 4 hardcoded strings):**
- `apps/android/app/src/main/java/**/*.kt` — all `R.string.*` and `stringResource()` calls

**Test files:**
- `apps/ios/Tests/**/*.swift` — XCUITest string assertions
- `apps/android/app/src/androidTest/**/*.kt` — Compose UI test assertions

## Tasks

### Task 1: Generate key mapping from old → new

**Files:**
- Create: `packages/i18n/tools/key-migration-map.ts` (temporary)

**Step 1: Write mapping script**

```typescript
#!/usr/bin/env bun
/**
 * Generates a JSON mapping of old flattened keys → new flattened keys.
 * Compares the current codegen output against a snapshot of pre-migration keys.
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

function flattenOld(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}_${key}` : key
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenOld(value as Record<string, unknown>, fullKey))
    } else if (typeof value === 'string') {
      result[fullKey] = value
    }
  }
  return result
}

function flattenNew(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = camelToSnake(key)
    const fullKey = prefix ? `${prefix}_${snakeKey}` : snakeKey
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenNew(value as Record<string, unknown>, fullKey))
    } else if (typeof value === 'string') {
      result[fullKey] = value
    }
  }
  return result
}

const data = JSON.parse(readFileSync(resolve(__dirname, '../locales/en.json'), 'utf-8'))
const oldKeys = flattenOld(data)
const newKeys = flattenNew(data)

// Build value→newKey index
const valueToNewKey = new Map<string, string>()
for (const [k, v] of Object.entries(newKeys)) {
  if (!valueToNewKey.has(v)) valueToNewKey.set(v, k)
}

// Map old keys to new keys
const mapping: Record<string, string> = {}
let changed = 0
for (const [oldKey, value] of Object.entries(oldKeys)) {
  if (oldKey in newKeys) {
    // Key unchanged
    if (oldKey !== oldKey) mapping[oldKey] = oldKey
  } else {
    // Key changed — find by value match
    const newKey = valueToNewKey.get(value)
    if (newKey) {
      mapping[oldKey] = newKey
      changed++
    } else {
      mapping[oldKey] = `MISSING:${oldKey}`
      changed++
    }
  }
}

console.log(`Keys that changed: ${changed}`)
console.log(`Keys unchanged: ${Object.keys(oldKeys).length - changed}`)
writeFileSync(resolve(__dirname, 'key-migration-map.json'), JSON.stringify(mapping, null, 2))
console.log('Written to key-migration-map.json')
```

**Step 2: Run it**

```bash
bun run packages/i18n/tools/key-migration-map.ts
```

**Step 3: Review the map**

Check `packages/i18n/tools/key-migration-map.json` for any `MISSING:` entries — these need manual resolution.

---

### Task 2: Update iOS string references

**Files:**
- Modify: all `.swift` files under `apps/ios/Sources/`

**Step 1: Run iOS validation to get the full list of broken refs**

```bash
bun run i18n:validate:ios
```

This prints every `NSLocalizedString("key")` that doesn't match the new codegen output.

**Step 2: Write a sed/script to do bulk replacement**

Using the key-migration-map.json, generate sed commands or write a script:

```bash
#!/bin/bash
# For each changed key, replace in all Swift files
while IFS= read -r line; do
  old=$(echo "$line" | jq -r '.old')
  new=$(echo "$line" | jq -r '.new')
  find apps/ios/Sources -name '*.swift' -exec sed -i '' "s/\"$old\"/\"$new\"/g" {} +
done < <(jq -r 'to_entries[] | @json' packages/i18n/tools/key-migration-map.json)
```

Or do it manually file by file — there are ~20 Swift files with NSLocalizedString calls.

**Key categories of changes expected:**

Most iOS keys are already snake_case and match. The main changes will be keys from nested objects whose prefixes were camelCase:
- None expected if iOS was already using `admin_tab_volunteers` style (which it is)

The bigger changes come from keys that were moved/merged in Task 3 of Epic 274. For example if `device_link_codes_match` was in the flat `device_link` object that got merged into `deviceLink`, the codegen now produces it from `deviceLink.codesMatch` → `device_link_codes_match` — same key! So most iOS keys should be unchanged.

**The keys most likely to change** are those from objects with camelCase names:
- `auditLog_*` → `audit_log_*` (if iOS uses any — check first)
- `callHistory_*` → `call_history_*` (if iOS uses any)
- `callSettings_*` → `call_settings_*`
- `customFields_*` → `custom_fields_*`
- `deviceLink_*` → `device_link_*`
- `panicWipe_*` → `panic_wipe_*`

**Step 3: Run validation again**

```bash
bun run i18n:validate:ios
```

Expected: 0 errors.

**Step 4: Commit**

```bash
git add apps/ios/Sources/
git commit -m "fix(ios): update all NSLocalizedString keys to match codegen output"
```

---

### Task 3: Update Android string references

**Files:**
- Modify: all `.kt` files under `apps/android/app/src/main/java/`

**Step 1: Run Android validation**

```bash
bun run i18n:validate:android
```

**Step 2: Fix broken R.string references**

Same approach as iOS. Android keys are already snake_case and likely unchanged, but verify any keys from camelCase-prefixed objects.

**Step 3: Fix 4 hardcoded strings**

These were identified in the research phase:

1. `apps/android/app/src/main/java/org/llamenos/hotline/ui/settings/DeviceLinkScreen.kt:286`
   - Change: `Text("Codes Match")` → `Text(stringResource(R.string.device_link_codes_match))`

2. `apps/android/app/src/main/java/org/llamenos/hotline/ui/auth/AuthViewModel.kt:368`
   - Change: `else -> "Incorrect PIN"` → `else -> context.getString(R.string.error_pin_incorrect)`
   - Note: AuthViewModel may need a Context parameter or use string resource differently

3. `apps/android/app/src/main/java/org/llamenos/hotline/ui/admin/VolunteersTab.kt:373`
   - Change: `label = { Text("Phone number") }` → `label = { Text(stringResource(R.string.settings_phone)) }`

4. `apps/android/app/src/main/java/org/llamenos/hotline/ui/admin/VolunteersTab.kt:411`
   - Change: `title = { Text("Volunteer Created") }` → `title = { Text(stringResource(R.string.volunteers_volunteer_added)) }`
   - Or add key `volunteer_created` to en.json if no existing key matches

**Step 4: Run validation again**

```bash
bun run i18n:validate:android
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git add apps/android/app/src/main/java/
git commit -m "fix(android): update R.string refs and fix 4 hardcoded strings"
```

---

### Task 4: Update iOS XCUITest string assertions

**Files:**
- Modify: `apps/ios/Tests/LlamenosUITests/**/*.swift`

**Step 1: Search for hardcoded strings in tests that match changed keys**

```bash
grep -r 'NSLocalizedString\|staticText\[' apps/ios/Tests/ --include='*.swift'
```

**Step 2: Update any test assertions that reference old key values**

XCUITests typically match by displayed text, not key names. But if any tests use `NSLocalizedString` to look up expected text, update the keys.

**Step 3: Run iOS UI tests**

```bash
bun run ios:uitest
```

**Step 4: Commit**

```bash
git add apps/ios/Tests/
git commit -m "fix(ios): update XCUITest assertions for i18n key changes"
```

---

### Task 5: Update Android UI test assertions

**Files:**
- Modify: `apps/android/app/src/androidTest/**/*.kt`

**Step 1: Search for string references in tests**

```bash
grep -r 'R\.string\.\|stringResource' apps/android/app/src/androidTest/ --include='*.kt'
```

**Step 2: Update any changed references**

**Step 3: Build Android tests**

```bash
bun run test:android
```

**Step 4: Commit**

```bash
git add apps/android/app/src/androidTest/
git commit -m "fix(android): update androidTest assertions for i18n key changes"
```

---

### Task 6: Clean up and final validation

**Step 1: Delete temporary migration files**

```bash
rm packages/i18n/tools/key-migration-map.ts packages/i18n/tools/key-migration-map.json
```

**Step 2: Run full i18n validation**

```bash
bun run i18n:validate:all
```

Expected: ALL platforms pass with 0 errors.

**Step 3: Run codegen check (CI simulation)**

```bash
bun run codegen:check
```

**Step 4: Run full test suite for changed platforms**

```bash
bun run test:changed
```

Or individually:

```bash
bun run test:desktop   # Verify Epic 274 didn't break desktop
bun run test:ios       # Verify iOS builds and tests pass
bun run test:android   # Verify Android builds and tests pass
```

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore(i18n): clean up migration artifacts, all platforms validated"
```

---

## Acceptance Criteria

- [ ] `bun run i18n:validate:all` passes with 0 errors across iOS, Android, and desktop
- [ ] All iOS `NSLocalizedString` keys match codegen output
- [ ] All Android `R.string.*` keys match codegen output
- [ ] Zero hardcoded user-facing strings in Android code
- [ ] iOS unit tests and XCUITests pass (118/118)
- [ ] Android unit tests and lint pass
- [ ] Desktop Playwright tests pass
- [ ] No temporary migration files left in the repo

## Dependencies

- **Requires Epic 274 completed first** — en.json must be canonicalized and codegen updated before mobile refs can be aligned

## Risks

- iOS XCUITests may match by displayed text — if values changed (not just keys), tests need text updates too
- Android ViewModel hardcoded string fix (#2) may need architecture change if Context isn't available
- Some keys may have been used in ways the validator doesn't detect (string concatenation, dynamic construction)
