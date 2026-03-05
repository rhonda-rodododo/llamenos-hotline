# Epic 265: i18n Android String Alignment

## Goal

Eliminate all unresolved `R.string.*` references in the Android Kotlin codebase by aligning Kotlin string names with the i18n codegen output. After this epic, Android builds with zero unresolved string references, `en.json` remains the single source of truth, and all 13 locales have complete key coverage.

## Context

The i18n pipeline works as follows:
1. `packages/i18n/locales/en.json` defines all strings in nested JSON
2. `packages/i18n/tools/i18n-codegen.ts` flattens nested keys with `_` separators and generates `strings.xml` for Android and `.strings` for iOS
3. Android Kotlin code references strings via `R.string.<flat_key>`

The problem: the Android Kotlin code was written with string names that don't match what codegen produces. There are two categories of mismatch:

- **305 string references** in Kotlin have no corresponding entry in `en.json` at all — these are genuinely missing strings that need to be added to the source of truth
- **23 string references** exist in `en.json` but the Kotlin code uses the wrong flattened name (e.g., code says `R.string.shift_clock_in` but the key lives under `shifts` section, so codegen produces `shifts_clock_in`)

35 Kotlin files across all screens are affected. iOS is NOT affected — iOS uses its own string referencing pattern that already matches codegen output.

### Design Decision

**The Kotlin code must conform to `en.json`, not the other way around.** `en.json` is the source of truth used by all platforms. When there is a naming conflict, the Kotlin `R.string.*` reference gets updated to match what codegen produces from the canonical JSON structure.

## Implementation

### Part 1: Fix 23 Kotlin References With Wrong Prefix

These strings already exist in `en.json` but the Kotlin code uses an incorrect flattened name. The fix is purely in Kotlin — rename the `R.string.*` reference to match codegen output.

Examples:
| Kotlin code uses | Codegen produces | Action |
|---|---|---|
| `R.string.active_calls` | `R.string.dashboard_active_calls` | Rename in Kotlin |
| `R.string.shift_clock_in` | `R.string.shifts_clock_in` | Rename in Kotlin |
| `R.string.off_shift` | `R.string.badge_off_shift` | Rename in Kotlin |

**Process:**
1. Run `bun run i18n:codegen` to generate current `strings.xml`
2. Extract all `<string name="...">` keys from the generated `values/strings.xml`
3. Grep all `R.string.*` references across `apps/android/`
4. Cross-reference to find the 23 mismatches where the string value exists but the key differs
5. For each mismatch, update the Kotlin file to use the correct codegen key

### Part 2: Add 305 Missing Strings to en.json

After fixing the prefix mismatches, the remaining unresolved references are strings that genuinely don't exist in `en.json`. These need to be added under the correct nested section so that codegen produces the exact flat key the Kotlin code expects.

**Process:**
1. Collect all remaining unresolved `R.string.*` names from the Kotlin code
2. For each, determine the correct section in `en.json` by examining the key prefix (e.g., `call_add_note` belongs under `call` section)
3. Determine the correct English text by reading the Kotlin UI context where the string is used
4. Add the entry to `en.json` under the correct section
5. Verify that `i18n-codegen` flattens it to the exact key the Kotlin code expects

**If a key cannot be placed in an existing section to produce the correct flat name:**
- The Kotlin code must be updated to use whatever flat name codegen produces from the logically correct section
- Never create artificial JSON sections just to match arbitrary Kotlin naming

### Part 3: Propagate to All 12 Non-English Locales

After `en.json` is updated with all new keys:
1. For each of the 12 non-English locale files (`es.json`, `zh.json`, `tl.json`, `vi.json`, `ar.json`, `fr.json`, `ht.json`, `ko.json`, `ru.json`, `hi.json`, `pt.json`, `de.json`):
   - Add every new key with the English value as a fallback
   - Maintain the same nested structure as `en.json`
2. This ensures `bun run i18n:validate` passes with zero missing keys

### Part 4: Regenerate and Verify

1. Run `bun run i18n:codegen` to regenerate all platform string files
2. Run `bun run i18n:validate` to confirm all 13 locales have complete coverage
3. Run Android build (`cd apps/android && ./gradlew assembleDebug`) to verify zero unresolved `R.string.*` references
4. Run Android unit tests (`./gradlew testDebugUnitTest`) and lint (`./gradlew lintDebug`)
5. Compile Android instrumented tests (`./gradlew compileDebugAndroidTestKotlin`)
6. Run `bun run typecheck && bun run build` to confirm no desktop/iOS regressions

## Automation Strategy

A helper script can automate the bulk of this work:

1. **Audit script**: Parse all Kotlin files for `R.string.\w+` references, parse generated `strings.xml` for available keys, output the delta (unresolved references with file locations)
2. **Bulk rename**: For Part 1 (wrong prefix), sed/replace across Kotlin files
3. **Bulk insert**: For Part 2 (missing strings), generate `en.json` additions by inferring section from prefix and English text from UI context
4. **Locale sync**: For Part 3, script to add missing keys to all non-English locales with English fallback values

## Files Affected

- `packages/i18n/locales/*.json` — 13 locale files (new keys added)
- `apps/android/app/src/main/java/org/llamenos/hotline/**/*.kt` — 35 Kotlin files (string reference renames)
- `apps/android/app/src/main/res/values*/strings.xml` — generated output (regenerated by codegen)

## Verification Checklist

1. `bun run i18n:codegen` — regenerates all platform strings without errors
2. `bun run i18n:validate` — all 13 locales have 100% key coverage vs. English
3. `cd apps/android && ./gradlew assembleDebug` — builds with zero unresolved `R.string.*`
4. `cd apps/android && ./gradlew testDebugUnitTest` — unit tests pass
5. `cd apps/android && ./gradlew lintDebug` — lint passes
6. `cd apps/android && ./gradlew compileDebugAndroidTestKotlin` — instrumented test compilation passes
7. `bun run typecheck && bun run build` — desktop builds with no regression
8. `bun run test` — Playwright E2E tests still pass (no desktop/iOS impact)
9. Grep confirms zero `R.string.*` references in Kotlin that are absent from generated `strings.xml`

## Risk Assessment

- **Low risk**: Kotlin string reference renames — mechanical find-and-replace, verified by compilation
- **Low risk**: Locale file additions — additive only, no existing keys modified
- **Medium risk**: Inferring correct English text for 305 missing strings — must read Kotlin UI context carefully to produce accurate user-facing text
- **Low risk**: iOS regression — iOS string references are independent of Android changes

## Dependencies

- Epic 205 (i18n Package Extraction) — established `packages/i18n/` structure and codegen tool
- Epic 207 (Android Client Foundation) — established the Android codebase

## Blocks

None. This is a standalone alignment fix.
