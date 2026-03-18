# Epic 364: Downstream Client Type Migration

**Status**: PENDING
**Priority**: High
**Depends on**: Epic 363 (wire schema coverage)
**Blocks**: None
**Branch**: `desktop`

## Summary

Replace ~100 manually-defined types across Desktop (TypeScript), iOS (Swift), and Android (Kotlin) clients with codegen'd types from `packages/protocol/`. Epic 363 added ~60 named response schemas and registered them for codegen — this epic consumes those generated types to eliminate duplicate type definitions, ensure cross-platform consistency, and make the codegen pipeline the single source of truth for all API types.

## Problem Statement

Each platform independently defines types that duplicate what the protocol codegen now produces:
- **Desktop** (`src/client/lib/api.ts`): ~40 manually-defined interfaces (`Volunteer`, `Shift`, `CallRecord`, `ActiveCall`, `Conversation`, etc.) that mirror protocol schemas
- **iOS** (`apps/ios/Sources/Models/`): ~15 Swift structs across 8 model files that duplicate codegen'd Codable types
- **Android** (`apps/android/app/src/main/java/org/llamenos/hotline/model/`): ~50 Kotlin data classes across 10 model files, some already using `typealias` but many hand-written

This means:
- API contract changes require updating 4 places (schema + 3 clients) instead of 1 (schema → codegen)
- Type drift: client types silently diverge from actual API responses (missing fields, wrong optionality)
- Mobile codegen is wasted — Swift/Kotlin types are generated but not imported

## Implementation

**Execution**: Phase 1 (Desktop) first since it's the most impactful and testable. Phases 2-3 (iOS/Android) can run in parallel after Phase 1 validates the approach.

### Phase 1: Desktop Client (TypeScript)

The desktop client defines types in `src/client/lib/api.ts`. Replace with imports from `@protocol/schemas` (Zod inferred types) or from `packages/protocol/generated/typescript/types.ts` (quicktype output).

**Strategy**: Import Zod-inferred types via `z.infer<typeof schema>` from `@protocol/schemas`. This is preferred over quicktype output because:
- Zod types are the source of truth
- They integrate with the existing import system (`@protocol/*` aliases)
- They're available at both type and runtime level

**Types to replace** (high-confidence direct replacements):

| Current Type (api.ts) | Replace With | Import From |
|----------------------|-------------|-------------|
| `Shift` | `z.infer<typeof shiftResponseSchema>` | `@protocol/schemas/shifts` |
| `CallRecord` | `z.infer<typeof callRecordResponseSchema>` | `@protocol/schemas/calls` |
| `ActiveCall` | `z.infer<typeof callRecordResponseSchema>` | `@protocol/schemas/calls` |
| `VolunteerPresence` | `z.infer<typeof callPresenceResponseSchema>` | `@protocol/schemas/calls` |
| `Volunteer` | `z.infer<typeof volunteerResponseSchema>` | `@protocol/schemas/volunteers` |
| `BanEntry` | `z.infer<typeof banResponseSchema>` | `@protocol/schemas/bans` |
| `EncryptedNote` | `z.infer<typeof noteResponseSchema>` | `@protocol/schemas/notes` |
| `Conversation` | `z.infer<typeof conversationResponseSchema>` | `@protocol/schemas/conversations` |
| `ConversationMessage` | `z.infer<typeof messageResponseSchema>` | `@protocol/schemas/conversations` |
| `InviteCode` | `z.infer<typeof inviteResponseSchema>` | `@protocol/schemas/invites` |
| `CaseRecord` | `z.infer<typeof recordSchema>` | `@protocol/schemas/records` |
| `RecordContact` | `z.infer<typeof recordContactSchema>` | `@protocol/schemas/records` |
| `CaseInteraction` | `z.infer<typeof caseInteractionSchema>` | `@protocol/schemas/interactions` |
| `ReportTypeDefinition` | `z.infer<typeof reportTypeDefinitionSchema>` | `@protocol/schemas/report-types` |
| `CallSettings` | `z.infer<typeof callSettingsSchema>` | `@protocol/schemas/settings` |
| `SpamSettings` | `z.infer<typeof spamSettingsSchema>` | `@protocol/schemas/settings` |

**Types to keep** (client-specific with UI extensions):
- `ShiftStatus` — wraps API response with computed `isOnShift` helper
- `ContactSummary`, `ContactTimeline` — aggregated timeline view (legacy route)
- `SystemHealth`, `ServiceStatus` — dashboard-specific aggregate types
- `Report` — extends Conversation with report-specific UI state
- `DirectoryContact` — CMS directory contact with relationship UI

**Approach per type**:
1. Export a type alias: `export type Shift = z.infer<typeof shiftResponseSchema>`
2. Update all consumers to use the same field names as the schema
3. Remove the old interface
4. If the client type has extra fields (e.g., computed properties), use intersection: `type ClientShift = z.infer<typeof shiftResponseSchema> & { isActive: boolean }`

### Phase 2: iOS Client (Swift)

Replace manually-defined Swift structs with codegen'd types from `packages/protocol/generated/swift/Types.swift`.

**Files to modify**:
- `apps/ios/Sources/Models/Shift.swift` — replace `Shift`, `ShiftStatusResponse`, `ShiftsListResponse`
- `apps/ios/Sources/Models/Conversation.swift` — replace `Conversation`, `ConversationMessage`, list responses
- `apps/ios/Sources/Models/Admin.swift` — replace `ClientVolunteer`, `BanEntry`
- `apps/ios/Sources/Models/Report.swift` — replace `ClientReportResponse`, `ReportsListResponse`
- `apps/ios/Sources/Models/Blast.swift` — replace `Blast`, `BlastsListResponse`
- `apps/ios/Sources/Models/CustomField.swift` — replace `CustomFieldDefinition`
- `apps/ios/Sources/Models/ReportType.swift` — replace `ClientReportTypeDefinition`

**Strategy**: Import generated types and use `typealias` for compatibility. Keep UI-specific extensions (e.g., computed display properties, SwiftUI conformances) as extensions on the codegen'd types.

### Phase 3: Android Client (Kotlin)

Replace manually-defined Kotlin data classes with codegen'd types from `packages/protocol/generated/kotlin/Types.kt`.

**Files to modify**:
- `apps/android/app/src/main/java/org/llamenos/hotline/model/CallModels.kt`
- `apps/android/app/src/main/java/org/llamenos/hotline/model/ConversationModels.kt`
- `apps/android/app/src/main/java/org/llamenos/hotline/model/AdminModels.kt`
- `apps/android/app/src/main/java/org/llamenos/hotline/model/NoteModels.kt`
- `apps/android/app/src/main/java/org/llamenos/hotline/model/CaseModels.kt`
- `apps/android/app/src/main/java/org/llamenos/hotline/model/HubModels.kt`
- `apps/android/app/src/main/java/org/llamenos/hotline/model/ReportModels.kt`
- `apps/android/app/src/main/java/org/llamenos/hotline/model/CustomFieldModels.kt`

**Strategy**: Many Android types already use `typealias` pointing to codegen'd types. For the hand-written duplicates, replace with `typealias` or direct import. Keep `@Serializable` annotations and Compose-specific extensions as needed.

## Files to Modify

### Phase 1 (Desktop)
| File | Change |
|------|--------|
| `src/client/lib/api.ts` | Replace ~16 interfaces with type aliases from `@protocol/schemas` |
| `src/client/routes/*.tsx` | Update any direct field access that changed names |
| `src/client/components/**/*.tsx` | Update prop types if they reference replaced interfaces |

### Phase 2 (iOS)
| File | Change |
|------|--------|
| `apps/ios/Sources/Models/*.swift` | Replace structs with typealias/import from Generated/Types.swift |
| `apps/ios/Sources/ViewModels/*.swift` | Update references to use new type names |
| `apps/ios/Sources/Services/APIService.swift` | Update response decoding to use codegen'd types |

### Phase 3 (Android)
| File | Change |
|------|--------|
| `apps/android/app/src/main/java/org/llamenos/hotline/model/*.kt` | Replace data classes with typealias/import |
| `apps/android/app/src/main/java/org/llamenos/hotline/api/*.kt` | Update API response types |
| `apps/android/app/src/main/java/org/llamenos/hotline/ui/**/*.kt` | Update UI references |

## Testing

### Phase 1
- `bun run typecheck` — zero errors after type replacement
- `bun run test` — all Playwright E2E tests pass
- `bun run test:backend:bdd` — 566 tests pass (no regression)

### Phase 2
- `bun run test:ios` — XCTest + XCUITest pass
- Swift compiler: zero errors/warnings from type mismatches

### Phase 3
- `bun run test:android` — unit tests + lint pass
- Kotlin compiler: zero errors from type mismatches

## Acceptance Criteria & Test Scenarios

- [ ] Desktop: zero manually-defined interfaces in `api.ts` that duplicate protocol schemas
- [ ] Desktop: all type imports come from `@protocol/schemas` (Zod inferred) not local definitions
- [ ] Desktop: `bun run typecheck && bun run test` passes
- [ ] iOS: model files use codegen'd types (typealias or direct import)
- [ ] iOS: `bun run test:ios` passes
- [ ] Android: model files use codegen'd types (typealias or direct import)
- [ ] Android: `bun run test:android` passes
- [ ] No duplicate type definitions across any platform for types that exist in protocol schemas
- [ ] Backlog files updated

## Risk Assessment

- **Low risk**: Desktop TypeScript replacement — same runtime, type-level only, Playwright catches regressions
- **Medium risk**: iOS/Android — codegen'd types may have different field names (quicktype naming conventions), requiring adapter patterns or codegen config tweaks
- **Mitigation**: Phase 1 (Desktop) validates the approach before committing to mobile platforms
