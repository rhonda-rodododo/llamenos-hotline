# Epic 313: Update Worker Integration Test Fixtures

## Problem

5 worker integration tests (`vitest.integration.config.ts`) fail because test fixtures use dummy data that no longer passes validation added in later epics.

### Failures

1. **RecordsDO: audit log hash chain** (2 tests) — `actorPubkey: 'admin-pub'` and `'vol-pub'` fail validation requiring 64-char hex or `'system'`
2. **SettingsDO: rate limit state** — response shape changed; `limited` property not found (returns different structure)
3. **SettingsDO: fallback ring group** — `volunteers` returns `[]` instead of expected array (response format change)
4. **ConversationDO: closed sender new conversation** — `recipientPubkeyHex` is too short for `hexToBytes('02' + ...)` — needs real 64-char hex pubkey

### Root Cause

Integration test fixtures were written with placeholder data (`'admin-pub'`, `'vol-pub'`, etc.) before pubkey format validation and API response format changes were added. The application code is correct — the test data is stale.

### Fix

Update test fixtures in `apps/worker/__tests__/integration/` to use:
- Valid 64-char hex pubkeys (can use deterministic test keys like `'aa'.repeat(32)`)
- Current API response shapes
- Correct ECIES-compatible key material for crypto operations

### Priority

Medium — these tests validate DO business logic in isolation. Currently 56/61 pass; the 5 failures are all fixture issues.

## Discovered

2026-03-13 during comprehensive Linux test session.
