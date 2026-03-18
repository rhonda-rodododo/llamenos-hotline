# Epic 365: BDD Behavioral Depth — Real Workflow Tests

**Status**: PENDING
**Priority**: High
**Depends on**: Epic 363 (wire schema coverage), Epic 364 (client type migration)
**Blocks**: None
**Branch**: `desktop`

## Summary

Replace shallow status-code-only BDD tests with realistic end-to-end workflow scenarios that validate data integrity, encryption round-trips, permission boundaries on actual data, state transition correctness, JSONB storage fidelity, and cross-domain lifecycle flows. Adds ~60 new scenarios across 8 feature files, plus crypto test helpers for real ECIES encrypt/decrypt verification. Target: every scenario tests a **behavior** (state change + downstream effect), not a **surface check** (status code + field presence).

## Problem Statement

The current 566 BDD tests provide broad coverage but shallow depth. Evidence:

1. **Double JSONB serialization** survived 537 "passing" tests — nothing checked whether `metadata` was an object or a stringified object. The bug was only caught when the Nostr relay rejected malformed events.

2. **E2EE tests use mock ciphertext** — `Buffer.from(text).toString('base64')` instead of real ECIES encryption. The "encrypted note round-trip" test passes even if the crypto is completely broken because it never actually encrypts or decrypts anything.

3. **Permission tests check endpoints, not data** — the permission matrix verifies "reviewer gets 403 on GET /volunteers" but never verifies "volunteer A cannot read volunteer B's notes" (data-level isolation).

4. **State transitions are untested** — no test verifies that banning a number actually prevents the next call, that removing a volunteer from a shift stops them from ringing, or that closing a conversation prevents new messages.

5. **Audit log hash chain is unverified** — tests check that audit entries exist but never verify the SHA-256 chain integrity (`previousEntryHash` → `entryHash`).

### Current vs Target Depth

| Dimension | Current | Target |
|-----------|---------|--------|
| Crypto verification | Mock base64, no decrypt | Real ECIES encrypt/decrypt with WASM |
| Data isolation | Endpoint 403 | Volunteer A can't read B's notes |
| State effects | "Ban created" | "Ban → call rejected → unban → call rings" |
| JSONB integrity | Field exists | Field is correct type, not double-serialized |
| Audit chain | Entry exists | Hash chain verifiable, no gaps |
| Lifecycle flows | Single CRUD ops | Multi-step workflows with side effects |

## Implementation

**Execution**: Phase 1 (helpers + feature files) → Phase 2 (step definitions) → Phase 3 (verification gate). All `@backend` tagged — no UI dependency.

### Phase 1: Test Infrastructure

#### 1.1 Crypto Test Helpers (`tests/crypto-helpers.ts`)

Create test-side crypto helpers using the WASM build of `packages/crypto/`:

```typescript
import { CryptoService } from '@llamenos/crypto-wasm'  // or direct noble-curves

export interface TestCryptoKit {
  /** Generate a random 32-byte symmetric key */
  generateContentKey(): Uint8Array

  /** Encrypt plaintext with XChaCha20-Poly1305 using a content key */
  encrypt(plaintext: string, contentKey: Uint8Array, label: string): string

  /** Decrypt ciphertext with XChaCha20-Poly1305 */
  decrypt(ciphertext: string, contentKey: Uint8Array, label: string): string

  /** ECIES wrap: encrypt contentKey for a recipient pubkey */
  wrapKeyForRecipient(contentKey: Uint8Array, recipientPubkey: string, senderSecretKey: string, label: string): {
    wrappedKey: string
    ephemeralPubkey: string
  }

  /** ECIES unwrap: decrypt contentKey from a wrappedKey envelope */
  unwrapKey(wrappedKey: string, ephemeralPubkey: string, recipientSecretKey: string, label: string): Uint8Array

  /** Compute blind index hash for a value */
  blindIndex(value: string, salt: string): string
}
```

This uses the same crypto primitives as the real app (noble-curves + noble-ciphers) so test crypto is identical to production crypto.

#### 1.2 Database Verification Helper (`tests/db-helpers.ts`)

Direct PostgreSQL queries for verifying persisted state — bypasses the API layer to catch bugs where the API returns stale/cached data or masks storage issues:

```typescript
import { drizzle } from 'drizzle-orm/bun-sql'
import { SQL } from 'bun'

const TEST_DB_URL = process.env.DATABASE_URL || 'postgres://llamenos:dev@localhost:5432/llamenos'

export class TestDB {
  private db = drizzle(new SQL(TEST_DB_URL))

  /** Verify a JSONB column contains a proper object, not a double-serialized string */
  async assertJsonbField(table: string, id: string, column: string): Promise<{
    value: unknown
    isObject: boolean
    isDoubleStringified: boolean
  }>

  /** Read raw row from any table by id */
  async getRow(table: string, id: string): Promise<Record<string, unknown> | null>

  /** Verify audit hash chain integrity directly in the DB */
  async verifyAuditChain(limit?: number): Promise<{
    valid: boolean
    totalEntries: number
    brokenAt?: number
  }>

  /** Check ban list contains a phone number at the DB level */
  async isBanned(phone: string): Promise<boolean>

  /** Get raw metadata JSONB for a conversation */
  async getConversationMetadata(id: string): Promise<unknown>

  /** Verify a volunteer's role assignment at the DB level */
  async getVolunteerRoles(pubkey: string): Promise<string[]>
}
```

This catches the class of bugs where the API layer works around storage issues (like the `parseMetadata()` workaround we added for double-serialization) — the DB helper tests the actual persisted state.

#### 1.3 JSONB & Audit Integrity Helpers (`tests/integrity-helpers.ts`)

```typescript
/** Assert a JSONB field is a proper object, not a double-serialized string */
export function assertJsonbObject(value: unknown, fieldName: string): Record<string, unknown>

/** Assert audit log hash chain integrity */
export function verifyAuditHashChain(entries: AuditEntry[]): { valid: boolean; brokenAt?: number }
```

### Phase 2: Feature Files & Step Definitions

#### 2.1 Call Lifecycle Workflows (`packages/test-specs/features/core/call-lifecycle.feature`)

```gherkin
@backend @lifecycle
Feature: Call Lifecycle Workflows

  Background:
    Given the server is reset
    And an admin and two volunteers exist with proper shifts

  Scenario: Full call lifecycle — ring, answer, note, end, history
    Given volunteer A and volunteer B are on the active shift
    When an incoming call arrives
    Then both volunteers should see the call as ringing
    When volunteer A answers the call
    Then volunteer B should no longer see the call as ringing
    And volunteer A should see the call as in-progress
    When volunteer A creates an encrypted note on the call
    And volunteer A ends the call
    Then the call should appear in history with status "completed"
    And the note should be retrievable by volunteer A
    And the note should be retrievable by the admin
    And volunteer B should NOT be able to read the note

  Scenario: Ban mid-call — caller disconnected, future calls rejected
    Given volunteer A is on the active shift
    And an incoming call arrives from a known number
    And volunteer A answers the call
    When the admin bans the caller's number
    Then the call should be ended
    When another call arrives from the same number
    Then the call should be rejected with reason "banned"

  Scenario: Volunteer removed from shift — stops ringing
    Given volunteer A and volunteer B are on the active shift
    When the admin removes volunteer B from the shift
    And an incoming call arrives
    Then only volunteer A should be in the ring group
    And volunteer B should NOT see the call

  Scenario: Call with no available volunteers — voicemail fallback
    Given no volunteers are on any shift
    And no fallback group is configured
    When an incoming call arrives
    Then the call status should be "no-volunteers"

  Scenario: Busy volunteer skipped in parallel ring
    Given volunteer A and volunteer B are on the active shift
    And volunteer A is already on an active call
    When a second incoming call arrives
    Then only volunteer B should be ringing for the second call
```

#### 2.2 E2EE Note Integrity (`packages/test-specs/features/security/e2ee-note-integrity.feature`)

```gherkin
@backend @security @crypto
Feature: E2EE Note Integrity

  Background:
    Given the server is reset
    And a volunteer and admin exist with known keypairs

  Scenario: Real ECIES encrypt-decrypt round-trip for notes
    Given the volunteer has secret key and admin has secret key
    When the volunteer encrypts "Patient reported chest pain" with a random content key
    And wraps the content key for the admin via ECIES
    And creates a note with the real ciphertext and admin envelope
    Then the admin can fetch the note
    And the admin can unwrap the content key from the envelope
    And the admin can decrypt the note content to "Patient reported chest pain"

  Scenario: Third-party volunteer cannot decrypt another's note
    Given volunteer A created an encrypted note for admin
    When volunteer B fetches the note
    Then volunteer B should receive the ciphertext
    But volunteer B cannot unwrap the content key (no envelope for them)

  Scenario: Multi-admin envelope — both admins can decrypt
    Given two admins exist
    When volunteer creates a note with envelopes for both admins
    Then admin A can unwrap and decrypt the note
    And admin B can unwrap and decrypt the note

  Scenario: Note content survives JSONB storage round-trip
    When a note is created with encryptedContent containing special characters
    Then fetching the note returns identical encryptedContent bytes
    And the ciphertext decrypts to the original plaintext
```

#### 2.3 Report-to-Case Conversion (`packages/test-specs/features/core/report-case-lifecycle.feature`)

```gherkin
@backend @lifecycle
Feature: Report-to-Case Conversion Lifecycle

  Background:
    Given the server is reset
    And case management is enabled
    And a conversion-enabled report type exists
    And an entity type for cases exists

  Scenario: Full report-to-case conversion workflow
    Given a reporter submits a report with encrypted content
    And a volunteer is assigned to the report
    When the volunteer exchanges 3 encrypted messages with the reporter
    Then the report should have 4 messages (1 initial + 3 replies)
    When the admin sets conversionStatus to "in_progress"
    And creates a case record linked to the report
    Then the case record should reference the report
    And the report should reference the case record
    And the report's conversionStatus should be "in_progress"
    When the admin sets conversionStatus to "completed"
    Then the report cannot be converted again (idempotency)

  Scenario: Reporter can only see their own reports
    Given reporter A submits a report
    And reporter B submits a different report
    When reporter A lists reports
    Then they should see only their own report
    And reporter B's report should NOT be in the list

  Scenario: Assigned volunteer receives report messages
    Given a report is assigned to volunteer A
    When the reporter sends a new message
    Then volunteer A should see the new message
    But volunteer B (not assigned) should NOT see the message

  Scenario: Report metadata persists through updates
    Given a report exists with reportTypeId and category
    When the admin updates conversionStatus
    Then the original reportTypeId and category are still present
    And metadata is a proper JSONB object (not double-serialized)
```

#### 2.4 JSONB Storage Fidelity (`packages/test-specs/features/security/storage-integrity.feature`)

```gherkin
@backend @storage
Feature: JSONB Storage Fidelity

  Background:
    Given the server is reset

  # Parameterized: tests every JSONB column across entity types
  Scenario Outline: <entity> JSONB field "<field>" survives storage round-trip
    When a <entity> is created with <field> containing <value>
    Then fetching the <entity> returns <field> as a proper <expectedType>
    And the DB row's <field> column is a JSONB <expectedType>, not a string

    Examples:
      | entity       | field                      | value                         | expectedType |
      | report       | metadata                   | {"reportTypeId":"abc"}        | object       |
      | volunteer    | supportedMessagingChannels  | ["sms","whatsapp"]            | array        |
      | record       | fieldValues                | {"severity":"high"}           | object       |
      | note         | adminEnvelopes             | [{"pubkey":"abc"}]            | array        |
      | conversation | metadata                   | {"type":"sms","channel":"wa"} | object       |

  Scenario Outline: Settings JSONB field "<setting>" round-trips correctly
    When <setting> settings are updated with <field> set to <value>
    Then fetching <setting> settings returns <field> as <expectedType> <value>
    And the DB value is not double-serialized

    Examples:
      | setting | field                | value | expectedType |
      | spam    | voiceCaptchaEnabled  | true  | boolean      |
      | spam    | rateLimitEnabled     | true  | boolean      |
      | call    | queueTimeoutSeconds  | 60    | number       |
      | call    | voicemailMaxSeconds  | 120   | number       |

  Scenario: Encrypted envelope fields are byte-accurate through storage
    When a note is created with specific encryptedContent hex
    And adminEnvelopes with specific wrappedKey hex
    Then fetching the note via API returns byte-identical encryptedContent
    And byte-identical wrappedKey values
    And the DB row contains the same bytes (no re-encoding)
```

#### 2.5 Permission Boundaries on Data (`packages/test-specs/features/security/data-isolation.feature`)

```gherkin
@backend @security @permissions
Feature: Data Isolation — Permission Boundaries on Data

  Background:
    Given the server is reset
    And test users exist for all default roles

  # Parameterized: tests data isolation across resource types and roles
  Scenario Outline: <role> can only see their own <resource>
    Given user A with role "<role>" creates a <resource>
    And user B with role "<role>" creates a <resource>
    When user A lists <resource>s
    Then the list contains only user A's <resource>
    When user B lists <resource>s
    Then the list contains only user B's <resource>
    When an admin lists <resource>s
    Then the admin sees both <resource>s

    Examples:
      | role      | resource     |
      | volunteer | note         |
      | reporter  | report       |
      | volunteer | case record  |

  Scenario: Hub-scoped data isolation across resources
    Given hub A and hub B exist with separate members
    And hub A has a shift, a ban, and a volunteer
    And hub B has a shift, a ban, and a volunteer
    When hub A's volunteer lists shifts
    Then they see only hub A's shift
    When hub B's volunteer lists shifts
    Then they see only hub B's shift

  Scenario Outline: Role change from "<from>" to "<to>" takes immediate effect
    Given a volunteer with "<from>" role
    When the admin changes their role to "<to>"
    Then the volunteer's next API call uses "<to>" permissions
    And the DB confirms the role is "<to>" (not cached)

    Examples:
      | from      | to       |
      | volunteer | reviewer |
      | reviewer  | volunteer |
      | volunteer | hub-admin |

  Scenario: Deactivated volunteer loses all access immediately
    Given an active volunteer with valid session
    When the admin deactivates the volunteer
    Then the volunteer's next API call returns 403
```

#### 2.6 Audit Trail Integrity (`packages/test-specs/features/security/audit-integrity.feature`)

```gherkin
@backend @security @audit
Feature: Audit Trail Integrity

  Background:
    Given the server is reset

  Scenario: Audit log captures all state-changing operations
    When the admin creates a volunteer
    And creates a shift
    And adds the volunteer to the shift
    And creates a ban
    Then the audit log should contain entries for all 4 operations
    And each entry should have the admin's pubkey as actor
    And each entry should have a non-empty details field

  Scenario: Audit hash chain is verifiable
    When the admin performs 5 operations
    Then fetching the audit log returns entries with entryHash and previousEntryHash
    And entry[1].previousEntryHash equals entry[0].entryHash
    And entry[2].previousEntryHash equals entry[1].entryHash
    And every entryHash matches sha256(version + timestamp + event + actor + details + previousEntryHash)

  Scenario: Audit entries cannot be tampered with
    Given 3 audit entries exist with a valid hash chain
    Then modifying any entry's details would break the chain verification
    And the verification function detects the break
```

#### 2.7 State Transition Validation (`packages/test-specs/features/core/state-transitions.feature`)

```gherkin
@backend @lifecycle
Feature: State Transition Validation

  Background:
    Given the server is reset

  Scenario: Conversation status transitions enforce rules
    Given a report with status "waiting"
    When the status is updated to "active"
    Then the update succeeds
    When the status is updated to "closed"
    Then the update succeeds
    When the status is updated to "active" again (reopen)
    Then the update succeeds (closed → active is allowed)

  Scenario: Ban and unban affect call routing in real-time
    Given a volunteer is on shift
    And a caller's number is NOT banned
    When a call arrives from that number
    Then the call status is "ringing"
    When the admin bans the number
    And another call arrives from that number
    Then the call is rejected
    When the admin unbans the number
    And another call arrives from that number
    Then the call status is "ringing" again

  Scenario: Shift changes affect next call routing
    Given volunteer A is on the active shift
    When a call arrives
    Then volunteer A is in the ring group
    When the admin removes volunteer A from the shift
    And the next call arrives
    Then the ring group does NOT include volunteer A

  Scenario: Report conversion is idempotent
    Given a report linked to a case with conversionStatus "completed"
    When the admin tries to create another case from the same report
    Then the operation should fail or return the existing link
    And the report should still have exactly 1 linked case
```

#### 2.8 Hub Key Lifecycle (`packages/test-specs/features/security/hub-key-lifecycle.feature`)

```gherkin
@backend @security @crypto
Feature: Hub Key Lifecycle

  Background:
    Given the server is reset

  Scenario: Hub key distributed to all members
    Given a hub with 3 members (admin + 2 volunteers)
    When the admin sets the hub key envelopes
    Then each member can fetch their own key envelope
    And each envelope contains a wrappedKey and ephemeralPubkey

  Scenario: Removed member loses hub key access
    Given a hub with admin and volunteer A
    And hub key envelopes are set for both
    When the admin removes volunteer A from the hub
    And updates hub key envelopes (re-wrap without volunteer A)
    Then volunteer A's GET /hubs/:id/key returns 404
    And admin's envelope is still valid

  Scenario: Hub key rotation on member departure
    Given a hub with admin and 2 volunteers
    And hub key envelopes are set
    When volunteer B is removed
    Then the admin should re-wrap the hub key for remaining members only
    And volunteer B should not have a valid key envelope
```

### Phase 3: Step Definitions

Create step definition files in `tests/steps/backend/` for each feature file:

| Feature File | Step Definition File |
|-------------|---------------------|
| `call-lifecycle.feature` | `call-lifecycle.steps.ts` |
| `e2ee-note-integrity.feature` | `e2ee-integrity.steps.ts` |
| `report-case-lifecycle.feature` | `report-case-lifecycle.steps.ts` |
| `storage-integrity.feature` | `storage-integrity.steps.ts` |
| `data-isolation.feature` | `data-isolation.steps.ts` |
| `audit-integrity.feature` | `audit-integrity.steps.ts` |
| `state-transitions.feature` | `state-transitions.steps.ts` |
| `hub-key-lifecycle.feature` | `hub-key-lifecycle.steps.ts` |

## Files to Create

| File | Purpose |
|------|---------|
| `tests/crypto-helpers.ts` | Real ECIES encrypt/decrypt/wrap/unwrap for test verification |
| `tests/db-helpers.ts` | Direct PostgreSQL queries for verifying persisted state (bypasses API) |
| `tests/integrity-helpers.ts` | JSONB structure assertions + audit hash chain verification |
| `packages/test-specs/features/core/call-lifecycle.feature` | Call workflow scenarios |
| `packages/test-specs/features/core/report-case-lifecycle.feature` | Report-to-case conversion |
| `packages/test-specs/features/core/state-transitions.feature` | State transition validation |
| `packages/test-specs/features/security/e2ee-note-integrity.feature` | Real crypto round-trips |
| `packages/test-specs/features/security/storage-integrity.feature` | JSONB fidelity |
| `packages/test-specs/features/security/data-isolation.feature` | Permission boundaries on data |
| `packages/test-specs/features/security/audit-integrity.feature` | Audit hash chain verification |
| `packages/test-specs/features/security/hub-key-lifecycle.feature` | Hub key management |
| `tests/steps/backend/call-lifecycle.steps.ts` | Call lifecycle step definitions |
| `tests/steps/backend/e2ee-integrity.steps.ts` | Crypto verification steps |
| `tests/steps/backend/report-case-lifecycle.steps.ts` | Report-case steps |
| `tests/steps/backend/storage-integrity.steps.ts` | JSONB fidelity steps |
| `tests/steps/backend/data-isolation.steps.ts` | Data isolation steps |
| `tests/steps/backend/audit-integrity.steps.ts` | Audit chain steps |
| `tests/steps/backend/state-transitions.steps.ts` | State transition steps |
| `tests/steps/backend/hub-key-lifecycle.steps.ts` | Hub key management steps |

## Files to Modify

| File | Change |
|------|--------|
| `tests/api-helpers.ts` | Add helpers for note creation with real crypto, report message exchange |
| `playwright.config.ts` | Ensure new feature files are picked up by `backend-bdd` project |

## Testing

- `bun run test:backend:bdd` — all existing 566 tests continue to pass
- ~60 new scenarios pass
- Target: **620+ total backend BDD scenarios**
- Every new scenario tests a **behavior** (state change + downstream effect)

## Acceptance Criteria & Test Scenarios

- [ ] Real ECIES encrypt/decrypt round-trip passes for notes
  → `e2ee-note-integrity.feature: "Real ECIES encrypt-decrypt round-trip for notes"`
- [ ] Volunteer cannot read another volunteer's notes (data isolation)
  → `data-isolation.feature: "Volunteer can only read their own notes"`
- [ ] Ban mid-call disconnects caller and prevents future calls
  → `call-lifecycle.feature: "Ban mid-call — caller disconnected, future calls rejected"`
- [ ] Report metadata survives JSONB round-trip without double-serialization
  → `storage-integrity.feature: "Conversation metadata stored as JSONB object"`
- [ ] Audit log hash chain is mathematically verifiable
  → `audit-integrity.feature: "Audit hash chain is verifiable"`
- [ ] Report-to-case conversion is idempotent
  → `state-transitions.feature: "Report conversion is idempotent"`
- [ ] Hub key rotation excludes removed members
  → `hub-key-lifecycle.feature: "Removed member loses hub key access"`
- [ ] All existing 566 BDD tests still pass (no regressions)
- [ ] Backlog files updated

## Feature Files

| File | Status | Description |
|------|--------|-------------|
| `packages/test-specs/features/core/call-lifecycle.feature` | New | 5 call workflow scenarios |
| `packages/test-specs/features/core/report-case-lifecycle.feature` | New | 4 report conversion scenarios |
| `packages/test-specs/features/core/state-transitions.feature` | New | 4 state transition scenarios |
| `packages/test-specs/features/security/e2ee-note-integrity.feature` | New | 4 crypto round-trip scenarios |
| `packages/test-specs/features/security/storage-integrity.feature` | New | 5 JSONB fidelity scenarios |
| `packages/test-specs/features/security/data-isolation.feature` | New | 5 data isolation scenarios |
| `packages/test-specs/features/security/audit-integrity.feature` | New | 3 audit chain scenarios |
| `packages/test-specs/features/security/hub-key-lifecycle.feature` | New | 3 hub key scenarios |

## Risk Assessment

- **Low risk**: JSONB fidelity tests, state transition tests — mechanical assertions on existing APIs
- **Medium risk**: Crypto helpers using noble-curves in test context — need to match production crypto exactly
- **High risk**: Data isolation tests may reveal real authorization bugs that need backend fixes
- **Mitigation**: Implement crypto helpers first and verify against known test vectors before writing scenarios that depend on them
