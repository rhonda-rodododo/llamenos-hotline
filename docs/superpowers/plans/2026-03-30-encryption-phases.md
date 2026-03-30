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

Read path:
```typescript
const hubKey = useHubKey(hubId)
const name = hubKey ? hubDecrypt(role.encryptedName, hubKey) : null
```

Write path:
```typescript
const hubKey = useHubKey(hubId)
const encryptedName = hubEncrypt(name, hubKey)
await updateRole({ encryptedName })
```

Components show skeleton/placeholder until hub key is available (requires PIN unlock).

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

### Task 2: Phase 2C — Drop Roles Slug Column

**Files:**
- Modify: `src/server/db/schema/settings.ts`
- Create: migration file

- [ ] **Step 1: Migration**

```sql
ALTER TABLE roles DROP COLUMN slug;
```

- [ ] **Step 2: Update schema**

Remove `slug` from Drizzle schema in `settings.ts`.

- [ ] **Step 3: Update code referencing role.slug**

```bash
grep -rn "\.slug\b" src/ --include="*.ts" --include="*.tsx" | grep -i role
```

Replace with `role.id` where used for identification. System roles identified by `isDefault` flag.

- [ ] **Step 4: Run tests**

```bash
bun run typecheck && bun run build && bun run test:unit && bun run test:api
```

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/settings.ts drizzle/ src/
git commit -m "feat(phase2c): drop roles.slug column, use role.id for identification"
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

### Task 4: Final Verification & Documentation

- [ ] **Step 1: Full test suite**

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
