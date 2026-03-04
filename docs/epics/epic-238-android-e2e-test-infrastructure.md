# Epic 238: Android E2E Test Infrastructure Hardening

## Goal

Fix structural issues in the Android BDD E2E test suite that prevent accurate test execution, then optimize test lifecycle for speed. Currently 171/381 tests fail (45%); the majority of failures stem from missing testTags/UI elements in app code and test infrastructure gaps.

## Context

The Android BDD test suite runs 381 Cucumber scenarios on a Pixel 6a against a Docker Compose backend over LAN (`http://192.168.50.95:3000`). Current results: 210 pass, 171 fail. Analysis reveals these root causes:

| Root Cause | Failures | Fix Location |
|---|---|---|
| Missing testTags in app Compose UI | ~80 | `app/src/main/java/.../ui/` |
| Missing text labels/error messages | ~30 | App Compose screens |
| Camera permission dialog blocks Device Link | 10 | Test infrastructure |
| Elements in collapsed SettingsSection | ~12 | Step definitions (partially fixed) |
| Crypto interop (no JNI .so) | 2 | Expected — blocked on Epic 237 |
| Demo mode timeouts | 2 | App code + step defs |
| Language selection assertions | 2 | Step definitions |

## Phase 1: Camera Permission Auto-Grant

**Problem**: Device Linking tests navigate to `DeviceLinkScreen` which launches `ActivityResultContracts.RequestPermission()` for `CAMERA`. The system permission dialog steals focus from the Compose test harness, causing `IllegalStateException: No compose hierarchies found`.

**Solution**: Grant camera permission before tests via `adb` shell command in `ScenarioHooks`.

### Implementation

In `ScenarioHooks.kt`, add permission grant in `@Before(order = 0)`:

```kotlin
import android.os.Build
import androidx.test.platform.app.InstrumentationRegistry

@Before(order = 0)
fun resetServerState() {
    // Grant camera permission to prevent system dialog stealing focus
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val packageName = instrumentation.targetContext.packageName
    instrumentation.uiAutomation.executeShellCommand(
        "pm grant $packageName android.permission.CAMERA"
    ).close()

    // ... existing server reset code ...
}
```

**Expected impact**: Fixes all 10 Device Linking test failures.

## Phase 2: Missing testTags in App UI

The largest category of failures (80+) comes from the app Compose UI lacking `testTag` modifiers that tests reference. These are real implementation gaps — the BDD specs define expected behavior, and the app must expose testable interfaces.

### Approach

Audit each failing screen and add `Modifier.testTag("...")` to:
- Screen root composables (e.g., `testTag("pin-unlock-screen")`, `testTag("dashboard-screen")`)
- Interactive elements (buttons, toggles, inputs)
- Status indicators (e2ee indicator, break banner, error messages)
- Navigation elements (admin tabs, back buttons)
- Content containers (report detail, volunteer detail, audit log entries)

### Key Missing testTags (by impact)

| testTag | Screen | Failures Fixed |
|---|---|---|
| Various admin screen tags | Admin panels | ~15 |
| `transcription-enabled-toggle` | Admin settings | 3 |
| `volunteer-detail-back` | Volunteer profile | 5 |
| Report detail tags | Reports screens | 5 |
| Ban management tags | Ban list screens | 11 |
| Shift scheduling tags | Shift screens | 6 |
| Note thread tags | Note thread view | 4 |

### Key Missing Text Labels

| Text | Screen | Failures Fixed |
|---|---|---|
| "Access Denied" error | Permission-denied screens | 6 |
| "Volunteer Added" label | Audit log entries | 3 |
| Validation error messages | Form validation | 3 |
| Demo mode content | Demo accounts | 2 |

## Phase 3: Flow-Based Test Optimization (Optional)

**Current overhead**: Each of 381 scenarios pays ~6 seconds for identity creation + Activity launch = ~38 minutes total setup.

**Optimization**: Group related scenarios into "flows" that share a single login session. Use Cucumber tag-based conditional hooks to skip server reset + identity creation for scenarios within the same flow.

### Flow Groups

| Flow Tag | Features | Scenarios | Savings |
|---|---|---|---|
| `@settings-flow` | 11 settings features | 45 | 264 sec |
| `@admin-flow` | 9 admin features | 33 | 192 sec |
| `@notes-flow` | 8 notes features | 31 | 180 sec |
| `@dashboard-flow` | 8 dashboard features | 26 | 150 sec |
| `@auth-flow` | 9 auth features | 20 | 114 sec |

**Implementation**: Add `FlowStateManager` singleton + conditional hooks. Details in Phase 3 of implementation below.

**Risk**: Medium — shared state between scenarios can cause cascading failures. Mitigate with `@isolation-required` tag escape hatch.

## Phase 4: Step Definition Reliability

Fix remaining step definition issues:
- Language selection `assertIsSelected` needs `SelectableGroup` semantics
- Demo mode setup wizard needs longer timeouts
- Note detail back navigation needs fallback strategies
- Report creation submit button enabled state check

## Verification

After each phase:
1. `cd apps/android && ./gradlew compileDebugAndroidTestKotlin` (compile check)
2. `adb logcat -c && ./gradlew connectedDebugAndroidTest` (full test run)
3. Compare failure count against baseline of 171

## Success Criteria

- Phase 1: Device Linking failures → 0 (from 10)
- Phase 2: Total failures < 50 (from 171)
- Phase 3: Test execution time < 12 minutes (from 19)
- Phase 4: Total failures < 20

## Dependencies

- Epic 237 (iOS build pipeline) blocks crypto interop tests (2 failures) — those are expected to fail until JNI `.so` files are linked
- Docker Compose backend must be running at `192.168.50.95:3000`

## Risk: Low-Medium

Phase 1-2 are low risk (additive changes). Phase 3 is medium risk (shared state between scenarios). Phase 4 is low risk (step definition fixes).
