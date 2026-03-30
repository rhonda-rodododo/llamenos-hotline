# Encryption Phases 2B–2D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade organizational metadata from server-key encryption to hub-key E2EE (Phase 2B), drop residual plaintext (Phase 2C), and upgrade remaining display-only fields from server-key to envelope E2EE (Phase 2D). Minimize the server-key attack surface.

**Architecture:** Phase 2A is already complete (all operational fields are server-key encrypted). Phase 2B changes service-layer encrypt/decrypt from server-key to hub-key for 13 org metadata fields. Phase 2C drops the roles `slug` column. Phase 2D adds envelope columns and switches to ECIES for volunteer phone and invite phone.

**Tech Stack:** Drizzle ORM, TypeScript, hub-key-manager.ts, envelope-field-crypto.ts, bun:test, Playwright

**Prerequisites:** All prior plans must be completed (the rename, PBAC, teams, tags, and contact enhancements all modify the same files).

---

### Task 1: Phase 2B — Hub-Key E2EE for Org Metadata (Service Layer)

**Files:**
- Modify: `src/server/services/settings.ts` (roles, custom fields, report categories, shifts, ring groups, blasts, transcription)
- Modify: `src/server/services/records.ts` (report types)
- Modify: `src/server/services/shifts.ts`
- Modify: `src/server/routes/hubs.ts`
- Modify: `src/server/routes/settings.ts`
- Modify: `src/server/routes/shifts.ts`
- Modify: `src/server/routes/report-types.ts`

Target fields (13 total across 8 tables):
| Table | Fields |
|-------|--------|
| `hubs` | `encryptedName`, `encryptedDescription` |
| `roles` | `encryptedName`, `encryptedDescription` |
| `custom_field_definitions` | `encryptedFieldName`, `encryptedLabel`, `encryptedOptions` |
| `report_types` | `encryptedName`, `encryptedDescription` |
| `report_categories` | `encryptedCategories` |
| `shift_schedules` | `encryptedName` |
| `ring_groups` | `encryptedName` |
| `blasts` | `encryptedName` |

- [ ] **Step 1: Write test verifying server cannot decrypt hub-key fields**

Create `src/server/lib/hub-key-e2ee.test.ts`:

```typescript
import { hubEncrypt, hubDecrypt, generateHubKey } from '../../client/lib/hub-key-manager'

describe('hub-key E2EE fields', () => {
  test('server cannot decrypt hub-key encrypted name', () => {
    const hubKey = generateHubKey()
    const encrypted = hubEncrypt('Legal Team', hubKey)
    // Server only has serverEncrypt/serverDecrypt — cannot decrypt hub-key data
    expect(() => serverDecrypt(encrypted, LABEL)).toThrow()
  })
})
```

- [ ] **Step 2: Update service layer — remove serverEncrypt/serverDecrypt for target fields**

For each target field, change the service from encrypt-on-write/decrypt-on-read to pass-through:

```typescript
// Before (server-key):
async createRole(data: { name: string, ... }) {
  const encryptedName = this.crypto.serverEncrypt(data.name, LABEL)
  await db.insert(roles).values({ encryptedName })
}

async getRoles() {
  const rows = await db.select().from(roles)
  return rows.map(r => ({ ...r, name: this.crypto.serverDecrypt(r.encryptedName, LABEL) }))
}

// After (pass-through — client handles encryption):
async createRole(data: { encryptedName: string, ... }) {
  await db.insert(roles).values({ encryptedName: data.encryptedName })
}

async getRoles() {
  return db.select().from(roles) // returns ciphertext, client decrypts
}
```

Do this for ALL 13 fields.

- [ ] **Step 3: Update API routes — accept ciphertext from client**

Each route that creates/updates these entities changes from accepting plaintext to accepting ciphertext:

```typescript
// Before:
const { name, description } = await c.req.json()
// After:
const { encryptedName, encryptedDescription } = await c.req.json()
```

- [ ] **Step 4: Update client components — encrypt on write, decrypt on read**

For each component that displays or edits these fields:

**Read path** (all components displaying org metadata):
```typescript
const hubKey = useHubKey(hubId)
const name = hubKey ? hubDecrypt(role.encryptedName, hubKey) : null
```

**Write path** (admin forms that create/edit org metadata):
```typescript
const hubKey = useHubKey(hubId)
const encryptedName = hubEncrypt(name, hubKey)
await updateRole({ encryptedName })
```

**Specific UI flows to address:**
- Hub switcher: show generic placeholder until PIN unlock + hub key decryption
- Admin settings pages (roles, custom fields, report types, shifts, ring groups, blasts): skeleton loaders until hub key available
- Call ring screen: show "Incoming call" without hub name pre-unlock, add hub name after unlock
- All admin creation/edit forms: encrypt text fields with hub key before API call

- [ ] **Step 5: Verify serverEncrypt/serverDecrypt removal**

```bash
grep -rn "serverEncrypt\|serverDecrypt" src/server/services/ src/server/routes/ | grep -v "blast_settings\|audit\|ivr_audio\|push_subscription\|subscriber\|provider_config\|geocoding\|signal_registration"
```

Expected: Zero hits for target fields. Only hits should be for fields that MUST stay server-key.

- [ ] **Step 6: Run tests**

```bash
bun run typecheck && bun run build
bun run test:unit
bun run test:api
bun run test:e2e
```

- [ ] **Step 7: Commit**

```bash
git add src/server/ src/client/
git commit -m "feat(phase2b): upgrade 13 org metadata fields from server-key to hub-key E2EE"
```

---

### Task 2: Phase 2C — Drop Residual Plaintext & Verify Constraints

**Files:**
- Modify: `src/server/db/schema/settings.ts`
- Create: migration file

- [ ] **Step 1: Migration — drop slug and add NOT NULL constraints**

```sql
ALTER TABLE roles DROP COLUMN slug;

-- Verify NOT NULL on all required encrypted columns
ALTER TABLE hubs ALTER COLUMN encrypted_name SET NOT NULL;
ALTER TABLE roles ALTER COLUMN encrypted_name SET NOT NULL;
ALTER TABLE custom_field_definitions ALTER COLUMN encrypted_field_name SET NOT NULL;
ALTER TABLE custom_field_definitions ALTER COLUMN encrypted_label SET NOT NULL;
ALTER TABLE report_types ALTER COLUMN encrypted_name SET NOT NULL;
ALTER TABLE shift_schedules ALTER COLUMN encrypted_name SET NOT NULL;
ALTER TABLE ring_groups ALTER COLUMN encrypted_name SET NOT NULL;
ALTER TABLE blasts ALTER COLUMN encrypted_name SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN encrypted_event SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN encrypted_details SET NOT NULL;
ALTER TABLE ivr_audio ALTER COLUMN encrypted_audio_data SET NOT NULL;
```

- [ ] **Step 2: Update schema**

Remove `slug` from Drizzle schema in `settings.ts`. Verify NOT NULL annotations match migration.

- [ ] **Step 3: Update code referencing role.slug**

```bash
grep -rn "\.slug\b" src/ --include="*.ts" --include="*.tsx" | grep -i role
```

Replace with `role.id` where used for identification.

- [ ] **Step 4: Grep for plaintext fallback patterns**

```bash
grep -rn "serverDecrypt.*||.*''\\|serverDecrypt.*??\\|fallback.*plaintext" src/server/ --include="*.ts"
```

Remove any dual-read patterns that fall back to plaintext columns when encrypted columns are empty. All writes should go to encrypted columns exclusively.

- [ ] **Step 5: Positive regression test for server-key fields**

Verify that fields that MUST stay server-key (`blast_settings`, `audit_log`, `ivr_audio`) still work:
```bash
bun test src/server/services/records.integration.test.ts  # audit log tests
bun test src/server/services/blasts.integration.test.ts   # blast settings tests if exist
```

- [ ] **Step 6: Run tests**

```bash
bun run typecheck && bun run build && bun run test:unit && bun run test:api
```

- [ ] **Step 7: Commit**

```bash
git add src/server/db/schema/settings.ts drizzle/ src/
git commit -m "feat(phase2c): drop roles.slug, add NOT NULL constraints, remove plaintext fallbacks"
```

---

### Task 3: Phase 2D — Envelope E2EE for Volunteer Phone & Invite Phone

**Files:**
- Modify: `src/server/db/schema/identity.ts` (add `phoneEnvelopes` to users table)
- Modify: `src/server/db/schema/identity.ts` (add `phoneEnvelopes` to invite_codes)
- Modify: `src/server/services/identity.ts` (switch phone encryption to envelope)
- Create: migration file

- [ ] **Step 1: Migration — add envelope columns**

```sql
ALTER TABLE users ADD COLUMN phone_envelopes JSONB NOT NULL DEFAULT '[]';
ALTER TABLE invite_codes ADD COLUMN phone_envelopes JSONB NOT NULL DEFAULT '[]';
```

- [ ] **Step 2: Update Drizzle schema**

Add to users table:
```typescript
phoneEnvelopes: jsonb<RecipientEnvelope[]>()('phone_envelopes').notNull().default([]),
```

Same for invite_codes.

- [ ] **Step 3: Update identity service — envelope encrypt phone**

In `IdentityService.createUser()`:
```typescript
// Before (server-key):
const encryptedPhone = this.crypto.serverEncrypt(phone, LABEL_USER_PII)

// After (envelope E2EE):
const { ciphertext, envelopes } = await this.crypto.envelopeEncrypt(
  phone, [pubkey, ...adminPubkeys], LABEL_USER_PII
)
// Store: { encryptedPhone: ciphertext, phoneEnvelopes: envelopes }
```

Same pattern for invite phone encryption.

- [ ] **Step 4: Update read paths — return envelopes, client decrypts**

Service methods that return user/invite data should include `phoneEnvelopes`. Client uses `decryptObjectFields()` to decrypt (same pattern as `encryptedName` + `nameEnvelopes`).

- [ ] **Step 4b: Update client write paths — encrypt before sending**

For volunteer phone (profile update) and invite phone (invite creation), the CLIENT must encrypt before sending:

```typescript
// In user profile update form:
const { ciphertext, envelopes } = await envelopeEncrypt(phone, [myPubkey, ...adminPubkeys], LABEL_USER_PII)
await updateUser(pubkey, { encryptedPhone: ciphertext, phoneEnvelopes: envelopes })

// In invite creation form:
const { ciphertext, envelopes } = await envelopeEncrypt(phone, [myPubkey], LABEL_USER_PII)
await createInvite({ ...data, encryptedPhone: ciphertext, phoneEnvelopes: envelopes })
```

The server route must accept `encryptedPhone` + `phoneEnvelopes` instead of plaintext `phone`.

- [ ] **Step 4c: Verify "already E2EE" fields are truly E2EE**

The spec lists 7 fields as "already E2EE." Verify each uses `envelopeEncrypt()`/`envelopeDecrypt()` in the service layer, NOT `serverEncrypt()`/`serverDecrypt()`:

```bash
grep -n "serverEncrypt\|serverDecrypt" src/server/services/identity.ts src/server/services/records.ts src/server/services/conversations.ts src/server/services/push.ts | grep -i "name\|last4\|label\|reason\|phone"
```

Any hits on fields that should be E2EE (volunteer name, ban phone/reason, invite name, callerLast4, contactLast4, deviceLabel, webauthn label) are bugs — fix them to use envelope encryption.

- [ ] **Step 5: Audit remaining serverEncrypt/serverDecrypt calls**

```bash
grep -rn "serverEncrypt\|serverDecrypt" src/server/services/ src/server/routes/
```

Every remaining hit must be for fields that require server-side processing. Document which fields remain server-key in a comment.

- [ ] **Step 6: Run tests**

```bash
bun run typecheck && bun run build
bun run test:unit
bun run test:api
bun run test:e2e
```

- [ ] **Step 7: Commit**

```bash
git add src/server/ drizzle/
git commit -m "feat(phase2d): upgrade user phone and invite phone from server-key to envelope E2EE"
```

---

### Task 4: Test Coverage & Final Verification

- [ ] **Step 1: Unit tests (bun:test)**

Verify or create:
- `src/server/lib/hub-key-e2ee.test.ts` — hub-key encrypt/decrypt round-trip for all 13 org metadata fields, hub isolation (hub A key can't decrypt hub B data)
- `src/server/lib/e2ee-verification.test.ts` — extend with newly upgraded fields (user phone, invite phone), verify server service cannot decrypt E2EE fields
- `src/shared/crypto-labels.test.ts` — verify `LABEL_USER_PII` string value unchanged after rename

```bash
bun run test:unit
```

- [ ] **Step 2: API tests (Playwright, no browser)**

Verify or create:
- `tests/api/hub-encryption.spec.ts` — API returns ciphertext (not plaintext) for hub name, role name, custom field name, report type name, shift name, ring group name, blast name
- `tests/api/user-pii.spec.ts` — user phone returned with `phoneEnvelopes` (not plaintext), client can decrypt
- `tests/api/roles.spec.ts` — role creation accepts encrypted name/description, API returns ciphertext
- Settings endpoints accept and return ciphertext for all Phase 2B fields

```bash
bun run test:api
```

- [ ] **Step 3: UI E2E tests (Playwright, Chromium)**

Verify:
- Hub switcher shows placeholders before PIN unlock, decrypted names after
- Role editor shows decrypted role names after unlock
- Settings pages (custom fields, report types, shifts, ring groups) show decrypted names after unlock
- Admin forms encrypt on submit (verify via network request inspection or API test)
- User profile shows decrypted phone after unlock

```bash
bun run test:e2e
```

- [ ] **Step 4: Full test suite**

```bash
bun run typecheck && bun run build && bun run lint
bun run test:all
```

- [ ] **Step 2: Document remaining server-key fields**

Add a comment in `src/server/lib/crypto-service.ts` documenting which fields remain server-key and why:

```typescript
/**
 * Fields that MUST remain server-key encrypted (server processes at runtime):
 *
 * blast_settings: welcome/bye/double-opt-in messages (server sends SMS)
 * audit_log: event, details (server writes audit entries)
 * ivr_audio: audio_data (server serves to telephony bridge)
 * push_subscriptions: endpoint, auth_key, p256dh_key (server sends push)
 * subscribers: identifier (server sends blasts)
 * provider_config: credentials (server calls telephony APIs)
 * geocoding_config: api_key (server calls geocoding API)
 * signal_registration_pending: number (server registers with Signal bridge)
 *
 * All other encrypted fields use hub-key E2EE or envelope E2EE.
 * See docs/superpowers/specs/2026-03-30-phase2d-*.md for details.
 */
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: document remaining server-key fields and complete encryption phases"
```
