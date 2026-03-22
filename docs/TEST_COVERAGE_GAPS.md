# Test Coverage Gaps

Generated: 2026-03-22

This document maps each client route and major feature to its test coverage, identifies gaps, and feeds into the Application Hardening workstream.

## Route Coverage Map

| Route | File | Coverage Status |
|-------|------|-----------------|
| `/login` | smoke, auth-guards, login-restore | Covered |
| `/setup` | setup-wizard, demo-mode | Covered |
| `/onboarding` | invite-onboarding, reports | Covered |
| `/notes` | notes-crud, notes-custom-fields, call-recording | Covered |
| `/calls` | call-recording, admin-flow | Partial — no call state machine E2E (ringing → answered → completed) |
| `/conversations` | conversations, messaging-epics | Partial — empty state tested; no real inbound message flow |
| `/volunteers` | admin-flow, volunteer-flow, pin-challenge | Covered |
| `/volunteers/:pubkey` | volunteer-flow | Partial — profile detail page not directly tested |
| `/shifts` | shift-management, admin-flow | Covered |
| `/bans` | ban-management | Covered |
| `/blasts` | blasts | Partial — composer and subscriber list load tested; no actual send, opt-in, or opt-out flow |
| `/reports` | reports | Covered |
| `/audit` | audit-log | Covered |
| `/help` | help | Covered |
| `/admin/hubs` | multi-hub | Partial — hub creation tested; hub switching and cross-hub scoping untested |
| `/admin/settings` | telephony-provider, webrtc-settings, rcs-channel | Partial — RCS channel barely tested (read-only spec); telephony save/restore covered |
| `/preferences` | theme | Partial — theme persistence tested; other preferences (language, notification settings) untested |
| `/profile-setup` | volunteer-flow, profile-settings | Covered |
| `/link-device` | device-linking | Covered |
| `/setup` (setup wizard) | setup-wizard | Covered |

## Feature Coverage Map

| Feature | Spec File(s) | Status |
|---------|-------------|--------|
| Admin login / PIN auth | smoke, auth-guards, admin-flow | Covered |
| Volunteer login | volunteer-flow | Covered |
| Session reload (PIN re-entry) | auth-guards, theme | Covered |
| Volunteer CRUD | admin-flow | Covered |
| Invite-based onboarding | invite-onboarding | Covered |
| Shift management (CRUD) | shift-management | Covered |
| Fallback ring group | shift-management | Partial — existence checked, assignment not tested |
| Ban list (add / delete / import) | ban-management | Partial — add covered; import/delete only partially |
| E2EE notes (create / edit / decrypt) | notes-crud, notes-custom-fields | Covered |
| Custom note fields | custom-fields, notes-custom-fields | Covered |
| Call recording / history | call-recording | Covered |
| Live call state machine | none | Not covered — ringing, parallel ring, pickup, handoff |
| WebRTC call preference | webrtc-settings | Covered |
| Client transcription (settings) | client-transcription | Covered |
| Client transcription (actual WASM) | none | Not covered — browser-level audio pipeline not tested |
| Reports (reporter role) | reports | Covered |
| Messaging channels | messaging-epics, conversations | Partial — API-level tested; no real inbound webhook simulation |
| Message blasts | blasts | Partial — UI loads; no send/opt-in/opt-out |
| Conversation reassignment | messaging-epics (Epic 70) | Covered |
| Message delivery status | messaging-epics (Epic 71) | Covered |
| Role management (CRUD) | roles | Covered |
| Permission enforcement | roles | Covered |
| Multi-hub (create) | multi-hub | Covered |
| Multi-hub (switch / cross-hub) | none | Not covered |
| Hub deletion / archiving | none | Not covered — not yet implemented |
| Audit log | audit-log | Covered |
| Setup wizard (all steps) | setup-wizard | Covered |
| Demo mode | demo-mode | Covered |
| Device linking | device-linking | Covered |
| Profile self-service | profile-settings | Covered |
| PIN challenge (step-up) | pin-challenge | Covered |
| Panic wipe | panic-wipe | Covered |
| PWA notifications | notification-pwa | Covered (UI only) |
| Responsive / mobile layout | responsive | Covered |
| Theme preferences | theme | Covered |
| Command palette | epic-24-27 | Covered |
| IVR voice prompts | epic-24-27 | Covered |
| Keyboard shortcuts | epic-24-27 | Covered |
| Spam mitigation toggles | epic-24-27 | Covered |
| Hub Settings (RCS channel) | rcs-channel | Partial — read-only check only |

## Priority Gaps

### High Priority (missing coverage for core hotline function)

1. **Live call state machine** — No E2E test exercises the full call flow: inbound Twilio webhook → parallel ring → volunteer accepts → call notes → hangup. This is the primary product feature.

2. **Inbound message webhook** — Messaging-epics tests create data via UI/API but never simulate a real inbound message webhook from Twilio/WhatsApp/Signal. The webhook routing path is untested.

3. **Multi-hub switching** — Hub creation is tested but switching context between hubs, per-hub data scoping, and cross-hub admin visibility are untested.

### Medium Priority

4. **Message blast send / opt-in / opt-out** — Only the composer UI loads. The actual send flow, subscriber opt-in via keyword, and opt-out are not tested.

5. **Hub deletion / archiving** — Not yet implemented, but once implemented needs E2E coverage including data retention and member notification.

6. **Volunteer profile detail page** (`/volunteers/:pubkey`) — The detail view is not directly navigated to in any spec.

7. **RCS channel configuration** — `rcs-channel.spec.ts` is read-only (no mutations). No test exercises enabling or saving RCS channel settings.

### Low Priority

8. **Client transcription WASM pipeline** — The settings toggle is tested but actual browser-level audio → WASM Whisper → transcript display is not testable without real audio input. Consider a mock.

9. **Language preferences** — `/preferences` is only tested for theme. Language switching and persistence are uncovered.

10. **Notification permission flow** — PWA notification banner is tested for UI state, but the actual push subscription registration is not tested end-to-end.
