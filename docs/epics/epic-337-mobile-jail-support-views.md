# Epic 337: Mobile Jail Support Views

**Status**: PENDING
**Priority**: Medium
**Depends on**: Epic 319 (Record Entity), Epic 321 (CMS RBAC), Epic 323 (Interactions), Epic 317 (Templates)
**Blocks**: None
**Branch**: `desktop` (mobile changes merged from mobile branches)

## Summary

Build a limited, read-heavy mobile interface for jail support field volunteers on iOS (SwiftUI) and Android (Compose). Covers 5 screens: case list, case summary, quick status update, court date viewer, and add comment. Includes an offline queue for status updates and comments when disconnected. Shared BDD scenarios drive both platforms.

## Problem Statement

The CMS backend and desktop UI are complete, but field volunteers who arrive at courthouses, police stations, or protest sites need mobile access. They need to:
- See the list of active arrest cases and their statuses
- View case summary (charges, attorney status, next court date) without editing full detail
- Tap to change status (e.g. "Arraigned" after a court appearance)
- See all upcoming court dates across cases
- Add a comment to a case timeline (e.g. "Appeared in Part B, adjourned to 4/15")

Mobile does NOT need: schema editor, template browser, contact directory, evidence upload, bulk operations, relationship graph. Those remain desktop-only per the design doc.

## Implementation

### Shared BDD Scenarios

Create feature files consumed by both platforms:

**File**: `packages/test-specs/features/platform/ios/cases/jail-support.feature`
**File**: `packages/test-specs/features/platform/android/cases/jail-support.feature`

Both reference the same scenarios (platform-specific tags only):

```gherkin
@ios
Feature: Jail Support Mobile Views (iOS)
  Field volunteers view and update cases on mobile.

  Background:
    Given I am logged in as a volunteer
    And case management is enabled
    And the "jail-support" template has been applied
    And arrest cases exist

  Scenario: Case list shows active cases
    When I navigate to the cases tab
    Then I should see a list of cases
    And each case shows case number, status, and contact name
    And cases are sorted by last updated

  Scenario: Pull to refresh reloads cases
    When I navigate to the cases tab
    And I pull to refresh
    Then the case list should reload

  Scenario: Tap case opens summary view
    When I navigate to the cases tab
    And I tap the first case
    Then I should see the case summary
    And the case number should be displayed
    And the status should be displayed
    And the charges should be displayed
    And the next court date should be displayed

  Scenario: Quick status update from summary
    Given I am viewing an arrest case with status "reported"
    When I tap the status pill
    And I select "In Custody"
    Then the status should update to "In Custody"
    And a confirmation should appear

  Scenario: Add comment to case timeline
    Given I am viewing an arrest case
    When I tap the "Add Comment" button
    And I type "Appeared in Part B, adjourned to 4/15"
    And I tap submit
    Then the comment should appear in the timeline
    And the input should be cleared

  Scenario: Court date viewer shows upcoming dates
    Given arrest cases with court dates exist
    When I navigate to the court dates tab
    Then I should see cases sorted by next court date
    And each row shows case number, date, and courtroom

  Scenario: Offline status update queues and syncs
    Given I am offline
    And I am viewing an arrest case
    When I tap the status pill
    And I select "Arraigned"
    Then the status should show as pending
    When connectivity is restored
    Then the status should sync and confirm
```

### iOS Implementation

#### Screen 1: CaseListView

**File**: `apps/ios/Sources/Views/Cases/CaseListView.swift`

```swift
struct CaseListView: View {
    @State private var cases: [CaseRecord] = []
    @State private var isLoading = false

    var body: some View {
        List(cases) { record in
            NavigationLink(destination: CaseSummaryView(record: record)) {
                CaseListRow(record: record)
            }
        }
        .refreshable { await loadCases() }
        .task { await loadCases() }
    }
}
```

Uses `CryptoService.shared` for decryption of summary-tier fields. Only fields at `accessLevel: 'all'` are shown -- mobile volunteers cannot see assigned or admin fields.

#### Screen 2: CaseSummaryView

**File**: `apps/ios/Sources/Views/Cases/CaseSummaryView.swift`

Read-only view showing:
- Case number (e.g. `JS-2026-0042`)
- Status pill (tappable for quick update)
- Charges field
- Attorney status
- Next court date
- Recent timeline entries (last 5)
- "Add Comment" button

#### Screen 3: QuickStatusUpdate

**File**: `apps/ios/Sources/Views/Cases/QuickStatusUpdate.swift`

Sheet presented when the status pill is tapped. Shows available statuses from the entity type definition as a picker list. Confirms with haptic feedback.

#### Screen 4: CourtDateViewer

**File**: `apps/ios/Sources/Views/Cases/CourtDateViewer.swift`

Filtered view of all cases that have a `next_court_date` field set. Sorted by date ascending. Each row shows case number, date, courtroom, and status pill.

#### Screen 5: AddCommentSheet

**File**: `apps/ios/Sources/Views/Cases/AddCommentSheet.swift`

Text input sheet for adding a comment to a case timeline. Encrypts via `CryptoService.shared` and POSTs to `POST /api/records/:id/interactions`.

#### Offline Queue

**File**: `apps/ios/Sources/Services/OfflineQueueService.swift`

Uses SwiftData (or UserDefaults as fallback) to store pending status updates and comments. `NWPathMonitor` detects connectivity changes and flushes the queue when online.

```swift
@Observable
class OfflineQueueService {
    private var pendingActions: [PendingAction] = []
    private let pathMonitor = NWPathMonitor()

    func enqueue(_ action: PendingAction) { ... }
    func flush() async { ... }
}
```

### Android Implementation

#### Screen 1: CaseListScreen

**File**: `apps/android/app/src/main/kotlin/org/llamenos/ui/cases/CaseListScreen.kt`

```kotlin
@Composable
fun CaseListScreen(
    viewModel: CaseListViewModel = hiltViewModel(),
    onCaseTap: (String) -> Unit,
) {
    val cases by viewModel.cases.collectAsStateWithLifecycle()
    val pullRefreshState = rememberPullToRefreshState()

    PullToRefreshBox(state = pullRefreshState, onRefresh = { viewModel.refresh() }) {
        LazyColumn {
            items(cases) { record ->
                CaseListItem(record = record, onClick = { onCaseTap(record.id) })
            }
        }
    }
}
```

#### Screen 2: CaseSummaryScreen

**File**: `apps/android/app/src/main/kotlin/org/llamenos/ui/cases/CaseSummaryScreen.kt`

#### Screen 3: QuickStatusUpdate

**File**: `apps/android/app/src/main/kotlin/org/llamenos/ui/cases/QuickStatusUpdateSheet.kt`

Bottom sheet with status options from entity type definition.

#### Screen 4: CourtDateScreen

**File**: `apps/android/app/src/main/kotlin/org/llamenos/ui/cases/CourtDateScreen.kt`

#### Screen 5: AddCommentSheet

**File**: `apps/android/app/src/main/kotlin/org/llamenos/ui/cases/AddCommentSheet.kt`

#### Offline Queue

**File**: `apps/android/app/src/main/kotlin/org/llamenos/service/OfflineQueueService.kt`

Uses Room database for pending actions. `ConnectivityManager.NetworkCallback` triggers flush.

### API Consumption

Both platforms consume existing endpoints:
- `GET /api/records?entityTypeId={id}&limit=50` -- case list
- `GET /api/records/:id` -- case detail
- `PATCH /api/records/:id` -- status update
- `POST /api/records/:id/interactions` -- add comment
- `GET /api/settings/entity-types` -- entity type definitions for status labels/colors

### i18n

Add mobile-specific CMS strings to `packages/i18n/locales/en.json`:

```json
{
  "caseManagement": {
    "mobileCaseList": "Cases",
    "courtDates": "Court Dates",
    "addComment": "Add Comment",
    "statusPending": "Pending sync...",
    "offlineQueued": "Queued for sync",
    "synced": "Synced"
  }
}
```

Run `bun run i18n:codegen` to generate iOS `.strings` and Android `strings.xml`.

## Files to Create

| File | Platform | Purpose |
|------|----------|---------|
| `apps/ios/Sources/Views/Cases/CaseListView.swift` | iOS | Case list with pull-to-refresh |
| `apps/ios/Sources/Views/Cases/CaseSummaryView.swift` | iOS | Read-only case summary |
| `apps/ios/Sources/Views/Cases/QuickStatusUpdate.swift` | iOS | Status change sheet |
| `apps/ios/Sources/Views/Cases/CourtDateViewer.swift` | iOS | Upcoming court dates |
| `apps/ios/Sources/Views/Cases/AddCommentSheet.swift` | iOS | Comment input |
| `apps/ios/Sources/Services/OfflineQueueService.swift` | iOS | Offline action queue |
| `apps/android/app/src/main/kotlin/org/llamenos/ui/cases/CaseListScreen.kt` | Android | Case list |
| `apps/android/app/src/main/kotlin/org/llamenos/ui/cases/CaseSummaryScreen.kt` | Android | Case summary |
| `apps/android/app/src/main/kotlin/org/llamenos/ui/cases/QuickStatusUpdateSheet.kt` | Android | Status change |
| `apps/android/app/src/main/kotlin/org/llamenos/ui/cases/CourtDateScreen.kt` | Android | Court dates |
| `apps/android/app/src/main/kotlin/org/llamenos/ui/cases/AddCommentSheet.kt` | Android | Comment input |
| `apps/android/app/src/main/kotlin/org/llamenos/service/OfflineQueueService.kt` | Android | Offline queue |
| `packages/test-specs/features/platform/ios/cases/jail-support.feature` | Shared | iOS BDD scenarios |
| `packages/test-specs/features/platform/android/cases/jail-support.feature` | Shared | Android BDD scenarios |

## Files to Modify

| File | Change |
|------|--------|
| `apps/ios/Sources/App/ContentView.swift` | Add Cases tab to tab bar |
| `apps/android/app/src/main/kotlin/org/llamenos/ui/navigation/AppNavigation.kt` | Add cases route |
| `packages/i18n/locales/en.json` | Add mobile CMS strings |
| `packages/i18n/locales/es.json` | Add mobile CMS strings (ES) |

## Testing

```bash
# iOS
bun run test:ios    # XCUITests for case list, summary, status update

# Android
bun run test:android    # Compose UI tests for case list, summary, status update
```

## Acceptance Criteria

- [ ] iOS: CaseListView displays cases from API, decrypts summary fields
- [ ] iOS: CaseSummaryView shows case number, status, charges, court date
- [ ] iOS: QuickStatusUpdate changes status via API
- [ ] iOS: CourtDateViewer shows sorted upcoming dates
- [ ] iOS: AddCommentSheet posts encrypted comment
- [ ] iOS: OfflineQueueService queues and syncs when connectivity restores
- [ ] Android: All equivalent screens functional
- [ ] Shared BDD scenarios pass on both platforms
- [ ] Offline queue handles >5 pending actions without data loss
- [ ] i18n codegen produces iOS .strings and Android strings.xml for CMS keys
- [ ] Minimum touch target 48px on all interactive elements

## Risk Assessment

- **High**: Offline queue reliability -- queued actions must not be lost on app kill. Mitigated by persisting to SwiftData/Room before returning success to UI.
- **Medium**: Encryption on mobile -- `CryptoService` must correctly decrypt summary-tier envelopes. Mitigated by reusing the same Rust crypto crate via UniFFI/JNI.
- **Medium**: Entity type definitions must be cached locally for offline status label rendering. Mitigated by caching on first fetch.
- **Low**: API consumption is straightforward -- same endpoints as desktop.
