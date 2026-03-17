# Epic 359: BDD Test Compatibility — Fix Service Response Shapes

**Status**: PENDING
**Priority**: High
**Depends on**: Epic 358 (DO → Drizzle migration)
**Blocks**: None
**Branch**: `desktop`

## Summary

Fix the 230 skipped backend BDD tests caused by response shape mismatches between the old DO architecture and the new Drizzle service layer. Three root causes account for all failures: API response nesting changes, auth validation gaps in dev mode, and audit log hash chain initialization.

## Problem Statement

After Epic 358's migration from Durable Objects to Drizzle ORM services, 417/647 BDD tests pass but 230 skip due to cascading failures. The failures are NOT architectural — they're response shape mismatches where the test helpers expect the old DO response format (`{ data: { shift: { id } } }`) but the new routes return a flatter shape (`{ data: { id } }`).

Three root causes:

| Root Cause | Affected Tests | Cascade |
|-----------|---------------|---------|
| `createShiftViaApi` accesses `data.shift.id` — `shift` wrapper missing | 50+ direct errors | 37+29+28+24+41 = 159 cascade skips |
| Auth middleware doesn't reject expired/tampered tokens in test scenarios | 3 direct failures | 44 cascade skips in auth-login.feature |
| Audit log first entry has non-null `previousEntryHash` | 1 direct failure | 11 cascade skips in audit-log.feature |

## Implementation

### Fix 1: API Response Shape Alignment (HIGH — 159+ tests)

The routes were migrated from DO fetch pattern (which returned `Response.json({ shift: result })`) to direct service calls (which return the result directly). Some routes now return `{ id, name, ... }` instead of `{ shift: { id, name, ... } }`.

**Two approaches — choose based on which is more correct:**

**Option A: Fix the test helpers** to match the new response shape. This is correct if the new shape is the desired API contract.

**Option B: Fix the routes** to wrap responses in the expected object key. This is correct if the API contract should remain backward-compatible with existing clients.

**Recommendation: Option B** — wrap responses to maintain API contract stability. The desktop, iOS, and Android clients expect the wrapped shape. Check each route's response against the corresponding protocol schema (e.g., `volunteerResponseSchema`, `shiftResponseSchema`).

**Files to audit** — every route that was migrated from `dos.X.fetch()` to `services.X.method()`:

Check the response wrapping for each endpoint:
```typescript
// WRONG (DO migration artifact — returns flat result):
const shift = await services.shifts.create(hubId, body)
return c.json(shift, 201)  // → { id, name, ... }

// CORRECT (matches API contract):
const shift = await services.shifts.create(hubId, body)
return c.json({ shift }, 201)  // → { shift: { id, name, ... } }
```

**Routes to check (high priority — used by test helpers):**
| Route | Endpoint | Expected wrapper | File |
|-------|----------|-----------------|------|
| shifts | `POST /shifts` | `{ shift }` | `routes/shifts.ts` |
| shifts | `PATCH /shifts/:id` | `{ shift }` | `routes/shifts.ts` |
| volunteers | `POST /volunteers` | `{ volunteer }` | `routes/volunteers.ts` |
| volunteers | `GET /volunteers` | `{ volunteers }` | `routes/volunteers.ts` |
| volunteers | `GET /volunteers/:pubkey` | direct object | `routes/volunteers.ts` |
| notes | `POST /notes` | `{ note }` | `routes/notes.ts` |
| notes | `GET /notes` | `{ notes }` | `routes/notes.ts` |
| bans | `POST /bans` | `{ ban }` / `{ ok }` | `routes/bans.ts` |
| bans | `GET /bans` | `{ bans }` | `routes/bans.ts` |
| calls | `GET /calls/active` | `{ calls }` | `routes/calls.ts` |
| calls | `GET /calls/presence` | `{ activeCalls, ... }` | `routes/calls.ts` |
| invites | `POST /invites` | `{ invite }` | `routes/invites.ts` |
| invites | `GET /invites` | `{ invites }` | `routes/invites.ts` |
| audit | `GET /audit` | `{ entries }` | `routes/audit.ts` |
| conversations | `GET /conversations` | `{ conversations }` | `routes/conversations.ts` |
| reports | `POST /reports` | `{ report }` | `routes/reports.ts` |
| settings/* | various | `{ spamSettings }`, `{ callSettings }`, etc. | `routes/settings.ts` |
| contacts-v2 | `POST /directory` | `{ contact }` | `routes/contacts-v2.ts` |
| records | `POST /records` | `{ record }` | `routes/records.ts` |
| events | `POST /events` | `{ event }` | `routes/events.ts` |

**Systematic approach:**
1. Read each test helper function in `tests/api-helpers.ts`
2. Check what response shape it expects (e.g., `data.shift.id`)
3. Find the corresponding route handler
4. Verify the route wraps the response correctly
5. Fix whichever side is wrong

### Fix 2: Auth Token Validation in Dev Mode (HIGH — 44 tests)

**Problem:** The auth middleware has a dev-mode bypass that auto-registers unknown pubkeys as volunteers. This is too permissive — it should still reject:
- Expired tokens (timestamp > 5 minutes old)
- Tampered signatures (invalid Schnorr signature)
- Tokens signed with unregistered keys (when the token itself is invalid)

**File:** `apps/worker/middleware/auth.ts`

The dev-mode bypass at line 23-43 currently catches ALL auth failures and tries pubkey-only auth. It should only bypass Schnorr SIGNATURE verification, not token FRESHNESS or FORMAT validation:

```typescript
// Current (too permissive):
if (!authResult && c.env.ENVIRONMENT === 'development') {
  const authPayload = parseAuthHeader(devAuthHeader)
  if (authPayload?.pubkey) {
    // Auto-register and authenticate — bypasses ALL validation
  }
}

// Fixed (preserves format/freshness checks):
if (!authResult && c.env.ENVIRONMENT === 'development') {
  const authPayload = parseAuthHeader(devAuthHeader)
  if (authPayload?.pubkey && validateToken(authPayload)) {
    // Only bypass signature verification, not token format/freshness
  }
}
```

The `validateToken()` function (already exists in `lib/auth.ts`) checks timestamp freshness. Adding this call preserves the "expired token → 401" behavior while still allowing dev-mode signature bypass.

### Fix 3: Audit Log Hash Chain Initialization (MEDIUM — 11 tests)

**Problem:** The first audit entry's `previousEntryHash` should be `null` (no previous entry in the chain). The AuditService may be computing a hash of `null`/empty and storing it.

**File:** `apps/worker/services/audit.ts`

Check the `log()` method's hash chain logic:
```typescript
// In the transaction:
const [latest] = await tx.select({ entryHash: auditLog.entryHash })
  .from(auditLog)
  .where(eq(auditLog.hubId, hubId))
  .orderBy(desc(auditLog.createdAt))
  .limit(1)
  .for('update')

const previousEntryHash = latest?.entryHash ?? null  // Should be null for first entry
```

If `previousEntryHash` is being set to a hash instead of `null` for the first entry, either:
- The `latest` query is returning a stale row (from before the test-reset), or
- The hash computation includes a default seed value instead of `null`

**Test expectation** (from `tests/steps/backend/admin.steps.ts`):
```typescript
expect(entry.previousEntryHash).toBeFalsy()  // First entry should have no previous hash
```

### Fix 4: Verify Simulation Endpoint Response Shapes (LOW — 8 tests)

The CMS triage and messaging flow tests use simulation endpoints (`/test-simulate/incoming-call`, `/test-simulate/incoming-message`). Check that these return the expected shapes:

```typescript
// simulateIncomingCall expects { callId, ... }
const { callId } = await simulateIncomingCall(request, { callerNumber })

// simulateIncomingMessage expects { conversationId, messageId }
const { conversationId, messageId } = await simulateIncomingMessage(request, { ... })
```

Verify the simulation endpoints in `routes/dev.ts` return these shapes.

## Testing

After each fix, run:
```bash
bun run test:backend:bdd
```

Track progress by counting remaining skips — the goal is 0 skipped (or only truly @skip-tagged tests).

## Acceptance Criteria & Test Scenarios

- [ ] `createShiftViaApi` succeeds — `data.shift.id` resolves correctly
  → All shift-dependent scenarios across 5+ feature files pass
- [ ] Expired auth tokens return 401, not 200
  → `auth-login.feature: "Expired token is rejected"` passes
- [ ] Tampered auth tokens return 401
  → `auth-login.feature: "Token with invalid signature is rejected"` passes
- [ ] First audit log entry has null `previousEntryHash`
  → `audit-log.feature: "Audit entries form a hash chain"` passes
- [ ] All 647 BDD tests pass (417 + 230 currently skipped → 647 passed)
- [ ] Zero regressions in the 417 currently passing tests

## Risk Assessment

- **Low risk**: Response shape fixes are mechanical — wrap/unwrap JSON objects
- **Low risk**: Auth validation fix adds one function call to the dev-mode bypass
- **Low risk**: Audit hash chain fix is a single conditional check
- **No architectural changes**: All fixes are in route handlers, middleware, or test helpers
