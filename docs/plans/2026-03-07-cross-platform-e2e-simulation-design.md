# Cross-Platform E2E Testing with Call/Event Simulation

**Date:** 2026-03-07
**Status:** Approved

## Problem

All iOS XCUITests (14 files, ~2000 lines) run in offline mock mode — they verify UI states
but never connect to the backend. The app has a broken API bootstrap (401 auth), missing i18n
strings, and zero call/message simulation capability on any mobile platform. Desktop Playwright
has live Twilio tests but they cost money per call and can't run in CI.

## Design

### Shared Call/Event Simulation Service

New backend endpoints in `apps/worker/routes/dev.ts` (development-only, guarded by
`ENVIRONMENT=development`):

| Endpoint | Purpose | Payload |
|----------|---------|---------|
| `POST /api/test-simulate/incoming-call` | Full inbound call (ringing + Nostr events) | `{ callerNumber, language?, hubId? }` → `{ callId, status }` |
| `POST /api/test-simulate/answer-call` | Volunteer answers | `{ callId, pubkey }` → `{ status }` |
| `POST /api/test-simulate/end-call` | Call ends | `{ callId }` → `{ status }` |
| `POST /api/test-simulate/voicemail` | Voicemail left | `{ callId }` → `{ status }` |
| `POST /api/test-simulate/incoming-message` | Inbound SMS/WhatsApp/Signal | `{ senderNumber, body, channel }` → `{ conversationId, messageId }` |
| `POST /api/test-simulate/delivery-status` | Delivery receipt | `{ conversationId, messageId, status }` |

These bypass TelephonyAdapter/MessagingAdapter and go straight to CallRouterDO/ConversationDO.
Real Nostr events are published, real audit logs created, real push notifications sent.

### Epic Breakdown

**E1: Fix iOS API Bootstrap (401 Auth)**
- Debug and fix `bootstrapTestIdentity()` in AppState.swift
- Fix WebSocket connection with hub URL
- Verify end-to-end: app launches → authenticates → sees real data
- Fix visible UI bugs found during screenshot audit

**E2: Shared Call/Event Simulation Service**
- Add 6 simulation endpoints to worker dev routes
- Each endpoint calls CallRouterDO/ConversationDO directly
- Publishes real Nostr events (KIND_CALL_RING, KIND_CALL_UPDATE, etc.)
- Add test helper functions for each platform (TS, Swift, Kotlin)

**E3: iOS API-Connected E2E Suite**
- Migrate all 14 test files from `launchAuthenticated()` to `launchWithAPI()`
- Add call simulation tests (incoming call → ring → answer → end)
- Add message simulation tests (inbound SMS → conversation created)
- Screenshot capture at each test step for visual regression
- Serial execution for API tests (shared server state)

**E4: Desktop Playwright Simulation Migration**
- Replace live Twilio tests with simulation endpoint calls
- Keep `tests/live/` for optional staging runs with real Twilio
- Add simulation helpers to `tests/helpers.ts`

**E5: Android API-Connected E2E Suite**
- Add Cucumber BDD scenarios using simulation endpoints
- Add simulation helper in Kotlin test utils

**E6: iOS Visual Audit & Bug Fixes**
- Screenshot every screen systematically
- Catalog all UI/i18n/layout bugs
- Fix each bug, verify with screenshots

### Dependencies

```
E1 ──┐
     ├──→ E3 (iOS E2E)
E2 ──┤
     ├──→ E4 (Desktop migration)
     ├──→ E5 (Android E2E)
     └──→ E6 (Visual audit, also needs E1)
```

E1 and E2 are independent and can run in parallel.

### Success Criteria

- iOS app successfully connects to Docker backend, authenticates, shows real data
- Simulated incoming call appears on all connected clients (Desktop, iOS, Android)
- All platforms have API-connected E2E tests that pass in CI
- Zero Twilio costs for CI test runs
- Every iOS screen has been screenshotted and audited for bugs
