# Epic 356: Mobile Critical Feature Gaps

**Status**: TODO
**Priority**: Critical
**Branch**: `desktop`

## Summary

Final audit (2026-03-16) identified critical mobile feature gaps that prevent production readiness on iOS and Android.

## Phase 1: iOS Push Notifications (Critical — calls won't ring)

**Problem**: `WakeKeyService` and wake-key crypto are built, but APNs pipeline is not wired. iOS users will not receive call notifications.

**Fix**:
- Add `aps-environment` entitlement to `project.yml`
- Call `UNUserNotificationCenter.requestAuthorization()` in `LlamenosApp.swift`
- Register for remote notifications
- Add `AppDelegate` with `didRegisterForRemoteNotificationsWithDeviceToken`
- Create notification service extension for background decryption
- Wire APNs token to server via `POST /api/devices/register`

## Phase 2: Missing Nostr Event Types (High — stale UI)

**Problem**: Mobile clients don't handle 4 event types that desktop does.

**Fix**:
- iOS `HubEventType`: add `callAnswered`, `presenceDetail`, `conversationNew`, `messageStatus`
- Android `LlamenosEvent`: add same 4 types
- Wire into respective ViewModels for UI refresh

## Phase 3: Deep Linking (High — UX)

**Problem**: Neither platform handles incoming deep links.

**Fix**:
- iOS: Add `CFBundleURLTypes` to Info.plist, `onOpenURL` handler in LlamenosApp
- Android: Add `onNewIntent` handling in MainActivity, route to NavGraph destinations
- Support: `llamenos://cases/{id}`, `llamenos://notes`, `llamenos://settings`

## Phase 4: iOS Call History

**Problem**: Desktop has `/calls` route; iOS has no call history screen.

**Fix**: Create `CallHistoryView.swift` with list of past calls, filtering by status/date.

## Phase 5: Mobile Offline Write Queue

**Problem**: Only desktop persists write operations during offline.

**Fix**: Port `offline-queue.ts` pattern to iOS (Swift) and Android (Kotlin). Use encrypted storage.

## Phase 6: Admin Feature Parity

Lower priority — these are admin-only features that can be managed from desktop:
- iOS: admin shift create/edit, roles management, report type config
- Android: report categories, roles management
- Both: WebAuthn/passkey enrollment, voice prompts, channel configs
