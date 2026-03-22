# Test Isolation Audit

Generated: 2026-03-22

## Summary

- Total spec files: 37
- Already isolated: 1
- Read-only (no reset needed): 3
- Needed reset added: 33

## Already Isolated

- `bootstrap.spec.ts` — calls `resetTestState(request)` correctly (pre-existing)

## Read-Only (No Server State Mutation)

These specs contain no `.fill`, `.click`, `request.post`, `request.put`, or `request.delete` calls and do not need a reset:

- `call-recording.spec.ts` — reads call history UI, no persisted mutations
- `panic-wipe.spec.ts` — clears localStorage only, no server state
- `rcs-channel.spec.ts` — reads admin settings page only

## Mutates State — Reset Added (33 files)

### Serial describe blocks — used `beforeAll` pattern (reset runs once per block)

| File | Pattern | Notes |
|------|---------|-------|
| `custom-fields.spec.ts` | `beforeAll` in outer serial describe | Tests depend on each other's state |
| `notes-custom-fields.spec.ts` | `beforeAll` in outer serial describe | Tests depend on each other's state |
| `telephony-provider.spec.ts` | `beforeAll` in serial describe | State shared across tests |
| `demo-mode.spec.ts` | `beforeAll` in outer describe | File-level serial configure |
| `multi-hub.spec.ts` | `beforeAll` + existing `beforeEach(loginAsAdmin)` | Tests run in order |
| `reports.spec.ts` | `beforeAll` in outer `'Reports feature'` describe | Inner describes share state |
| `messaging-epics.spec.ts` | `beforeAll` in first describe (Epic 68) | Multiple serial describes |
| `roles.spec.ts` | `beforeAll` in first describe (Role Management API) | Multiple serial describes |

### Standard pattern — used `beforeEach` with `request`

| File | Pattern | Notes |
|------|---------|-------|
| `admin-flow.spec.ts` | Added `request` to existing `beforeEach({ page })` | Pattern A |
| `audit-log.spec.ts` | Added `request` to existing `beforeEach({ page })` | Pattern A |
| `ban-management.spec.ts` | Added `request` to existing `beforeEach({ page })` | Pattern A |
| `epic-24-27.spec.ts` | Added `request` to all 4 `beforeEach` blocks | Pattern A |
| `form-validation.spec.ts` | Added `request` to existing `beforeEach({ page })` | Pattern A |
| `notes-crud.spec.ts` | Added `request` to existing `beforeEach({ page })` | Pattern A |
| `shift-management.spec.ts` | Added `request` to existing `beforeEach({ page })` | Pattern A |
| `setup-wizard.spec.ts` | Added `request` to existing `beforeEach({ page })` | Pattern A |
| `webrtc-settings.spec.ts` | Added `request` to existing `beforeEach({ page })` | Pattern A |
| `theme.spec.ts` | Added `request` to existing `beforeEach({ page })` | Pattern A |
| `blasts.spec.ts` | New `beforeEach({ request })` added | Pattern B |
| `client-transcription.spec.ts` | New `beforeEach({ request })` added | Pattern B |
| `conversations.spec.ts` | New `beforeEach({ request })` added | Pattern B |
| `auth-guards.spec.ts` | New `beforeEach({ request })` added | Pattern B |
| `device-linking.spec.ts` | Added `request` to existing `beforeEach({ page })` | Pattern A |
| `help.spec.ts` | New `beforeEach({ request })` added | Pattern B |
| `invite-onboarding.spec.ts` | New `beforeEach({ request })` added | Pattern B |
| `login-restore.spec.ts` | New `beforeEach({ request })` + new import | Pattern B |
| `notification-pwa.spec.ts` | New `beforeEach({ request })` added | Pattern B |
| `pin-challenge.spec.ts` | New `beforeEach({ request })` added | Pattern B |
| `responsive.spec.ts` | File-level `beforeEach({ request })` (no describe wrapper) | Pattern B |
| `smoke.spec.ts` | File-level `beforeEach({ request })` (no describe wrapper) | Pattern B |
| `capture-screenshots.spec.ts` | New `beforeEach({ request })` inside existing describe | Pattern B |
| `profile-settings.spec.ts` | New `beforeAll({ request })` before existing `beforeAll({ browser })` | Pattern C |
| `volunteer-flow.spec.ts` | New `beforeAll({ request })` before existing `beforeAll({ browser })` | Pattern C |

## Grep Patterns Used

- Mutation detection: `.fill`, `.click`, `request.post`, `request.put`, `request.delete`
- Correct reset call: `resetTestState(request)` (takes `request` fixture, not zero args)
- Serial block detection: `mode: 'serial'`

## Verification Command

```bash
# Should return empty output if all mutation specs have resets:
grep -rL "resetTestState(request)" tests/*.spec.ts | \
  xargs grep -l "\.fill\|\.click\|request\.post\|request\.put\|request\.delete" 2>/dev/null
```
