# Contact Directory v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a privacy-preserving contact directory with E2EE envelope encryption, permission-gated two-tier access, support contact relationships, auto-linking via phone HMAC, and call integration.

**Architecture:** New `contacts`, `contact_relationships`, `contact_call_links`, and `contact_conversation_links` tables with ECIES envelope encryption at three tiers (summary, PII, relationships). New `ContactService` handles all contact CRUD. Existing contacts route is replaced with full CRUD. Frontend adds directory page, profile page, and create dialog using existing shadcn/ui + Tailwind v4 patterns.

**Tech Stack:** Drizzle ORM (PostgreSQL), Hono routes, ECIES envelope encryption via `CryptoService`, TanStack Router, shadcn/ui, Tailwind v4, Lucide icons, `bun:test` for unit tests, Playwright for API integration tests.

**Worktree:** `~/projects/llamenos-hotline-contact-directory` on branch `feat/contact-directory` (based on `feat/field-level-encryption`).

---

## File Structure

### New Files

| File | Purpose |
|------|---------|
| `src/server/db/schema/contacts.ts` | Drizzle schema: contacts, contact_relationships, contact_call_links, contact_conversation_links |
| `src/server/services/contacts.ts` | ContactService — CRUD, timeline aggregation, dedup, auto-linking |
| `src/server/services/contacts.test.ts` | Unit tests for ContactService |
| `src/client/routes/contacts.tsx` | Contact directory page (table view, search, filters) |
| `src/client/routes/contacts.$contactId.tsx` | Contact profile page (sidebar + timeline) |
| `src/client/components/contacts/create-contact-dialog.tsx` | Create/edit contact dialog |
| `src/client/components/contacts/contact-select.tsx` | Searchable contact picker for custom fields |
| `src/client/components/contacts/contact-timeline.tsx` | Unified timeline component |
| `src/client/components/contacts/contact-relationship-section.tsx` | Support contacts section |
| `tests/api/contacts-directory.spec.ts` | API integration tests for contact CRUD |
| `drizzle/migrations/NNNN_contacts_directory.sql` | Migration for new tables |

### Modified Files

| File | Changes |
|------|---------|
| `src/shared/crypto-labels.ts` | Add 3 new crypto labels |
| `src/shared/permissions.ts` | Add 7 new contact permissions, update default roles |
| `src/shared/types.ts` | Add contact types, extend CustomFieldDefinition type |
| `src/server/db/schema/index.ts` | Export new contacts schema |
| `src/server/services/index.ts` | Add ContactService to Services interface |
| `src/server/routes/contacts.ts` | Replace with full CRUD + relationships + timeline |
| `src/server/app.ts` | Already registered — no changes needed |
| `src/client/lib/api.ts` | Add contact API functions |
| `src/client/components/notes/custom-field-inputs.tsx` | Add contact/contacts field renderer |
| `src/client/locales/en.json` (+ 12 other locales) | Add contact i18n keys |

---

### Task 1: Crypto Labels & Shared Types

**Files:**
- Modify: `src/shared/crypto-labels.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add crypto labels**

Add to `src/shared/crypto-labels.ts` before the closing comment:

```typescript
// --- Contact Directory Encryption ---

/** Contact summary (Tier 1) — display name, notes, languages. Enveloped for contacts:read-summary recipients. */
export const LABEL_CONTACT_SUMMARY = 'llamenos:contact-summary'

/** Contact PII (Tier 2) — full name, phone, email, address, DOB. Enveloped for contacts:read-pii recipients. */
export const LABEL_CONTACT_PII = 'llamenos:contact-pii'

/** Contact relationship payload — fully E2EE, server sees nothing. Enveloped for contacts:read-pii recipients. */
export const LABEL_CONTACT_RELATIONSHIP = 'llamenos:contact-relationship'
```

- [ ] **Step 2: Add contact types to shared/types.ts**

Add after the `CustomFieldContext` type definition:

```typescript
// --- Contact Directory ---

export type ContactType = 'caller' | 'partner-org' | 'referral-resource' | 'other'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  caller: 'Caller',
  'partner-org': 'Partner Org',
  'referral-resource': 'Referral Resource',
  other: 'Other',
}

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

/** Decrypted relationship between two contacts (from encrypted payload) */
export interface RelationshipPayload {
  fromContactId: string
  toContactId: string
  relationship: string
  isEmergency: boolean
}

/** Contact summary fields (Tier 1 — all members with contacts:read-summary) */
export interface ContactSummary {
  displayName: string
  notes: string
  languages: string[]
}

/** Contact PII fields (Tier 2 — per-field encrypted for contacts:read-pii) */
export interface ContactPIIBlob {
  emailAddresses: string[]
  address: string
  dateOfBirth: string
  identifiers: { label: string; value: string }[]
}
```

- [ ] **Step 3: Extend CustomFieldDefinition type**

In the `type` union of `CustomFieldDefinition`, add `'contact' | 'contacts'`:

```typescript
export interface CustomFieldDefinition {
  id: string
  name: string
  label: string
  type: 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'file' | 'location' | 'contact' | 'contacts'
  // ... rest unchanged
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run typecheck`
Expected: PASS (new types are additive, no breaking changes)

- [ ] **Step 5: Commit**

```bash
cd ~/projects/llamenos-hotline-contact-directory
git add src/shared/crypto-labels.ts src/shared/types.ts
git commit -m "feat(shared): add contact directory crypto labels and types"
```

---

### Task 2: Permissions

**Files:**
- Modify: `src/shared/permissions.ts`

- [ ] **Step 1: Add contact permissions to PERMISSION_CATALOG**

Replace the existing contacts section in `PERMISSION_CATALOG`:

```typescript
  // Contacts
  'contacts:create': 'Create new contacts and relationships',
  'contacts:read-summary': 'View contact summaries (display name, notes, tags)',
  'contacts:read-pii': 'View contact PII (full name, phone, email, address)',
  'contacts:update-summary': 'Edit contact summary fields',
  'contacts:update-pii': 'Edit contact PII fields',
  'contacts:delete': 'Delete contacts',
  'contacts:link': 'Link/unlink calls and conversations to contacts',
```

- [ ] **Step 2: Update default role assignments**

Update Hub Admin role — replace the two old contacts permissions:

```typescript
  // In role-hub-admin permissions array, replace:
  //   'contacts:read',
  //   'contacts:read-history',
  // With:
      'contacts:*',
```

Update Volunteer role — add contact create and read-summary:

```typescript
  // In role-volunteer permissions array, add:
      'contacts:create',
      'contacts:read-summary',
```

Update Voicemail Reviewer role — replace `'contacts:read'` with `'contacts:read-summary'`.

- [ ] **Step 3: Run typecheck**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd ~/projects/llamenos-hotline-contact-directory
git add src/shared/permissions.ts
git commit -m "feat(permissions): add contact directory permissions and update default roles"
```

---

### Task 3: Database Schema

**Files:**
- Create: `src/server/db/schema/contacts.ts`
- Modify: `src/server/db/schema/index.ts`

- [ ] **Step 1: Create contacts schema**

Create `src/server/db/schema/contacts.ts`:

```typescript
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import type { RecipientEnvelope } from '../../../shared/types'
import { jsonb } from '../bun-jsonb'
import { ciphertext, hmacHashed } from '../crypto-columns'

export const contacts = pgTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),

    // Plaintext (queryable)
    contactType: text('contact_type').notNull().default('caller'),
    riskLevel: text('risk_level').notNull().default('low'),
    tags: jsonb<string[]>()('tags').notNull().default([]),
    identifierHash: hmacHashed('identifier_hash'),

    // Tier 1 — ECIES envelopes (contacts:read-summary recipients)
    encryptedDisplayName: ciphertext('encrypted_display_name').notNull(),
    displayNameEnvelopes: jsonb<RecipientEnvelope[]>()('display_name_envelopes')
      .notNull()
      .default([]),
    encryptedNotes: ciphertext('encrypted_notes'),
    notesEnvelopes: jsonb<RecipientEnvelope[]>()('notes_envelopes').notNull().default([]),

    // Tier 2 — per-field ECIES (contacts:read-pii recipients)
    encryptedFullName: ciphertext('encrypted_full_name'),
    fullNameEnvelopes: jsonb<RecipientEnvelope[]>()('full_name_envelopes').notNull().default([]),
    encryptedPhone: ciphertext('encrypted_phone'),
    phoneEnvelopes: jsonb<RecipientEnvelope[]>()('phone_envelopes').notNull().default([]),

    // Tier 2 — blob ECIES (contacts:read-pii recipients)
    encryptedPII: ciphertext('encrypted_pii'),
    piiEnvelopes: jsonb<RecipientEnvelope[]>()('pii_envelopes').notNull().default([]),

    // Metadata
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),
  },
  (table) => [
    index('contacts_hub_idx').on(table.hubId),
    index('contacts_identifier_hash_idx').on(table.hubId, table.identifierHash),
  ]
)

export const contactRelationships = pgTable(
  'contact_relationships',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),

    // Fully E2EE — server sees nothing about who is linked
    encryptedPayload: ciphertext('encrypted_payload').notNull(),
    payloadEnvelopes: jsonb<RecipientEnvelope[]>()('payload_envelopes').notNull().default([]),

    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('contact_relationships_hub_idx').on(table.hubId)]
)

export const contactCallLinks = pgTable(
  'contact_call_links',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    contactId: text('contact_id').notNull(),
    callId: text('call_id').notNull(),
    linkedBy: text('linked_by').notNull(), // pubkey or 'auto'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('contact_call_links_contact_idx').on(table.contactId),
    index('contact_call_links_call_idx').on(table.callId),
  ]
)

export const contactConversationLinks = pgTable(
  'contact_conversation_links',
  {
    id: text('id').primaryKey(),
    hubId: text('hub_id').notNull().default('global'),
    contactId: text('contact_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    linkedBy: text('linked_by').notNull(), // pubkey or 'auto'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('contact_conversation_links_contact_idx').on(table.contactId),
    index('contact_conversation_links_conversation_idx').on(table.conversationId),
  ]
)
```

- [ ] **Step 2: Export from schema index**

Add to `src/server/db/schema/index.ts`:

```typescript
export {
  contacts,
  contactRelationships,
  contactCallLinks,
  contactConversationLinks,
} from './contacts'
```

- [ ] **Step 3: Generate migration**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run migrate:generate`

Verify the generated SQL creates the 4 tables with correct column types and indexes.

- [ ] **Step 4: Apply migration locally**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run migrate`
Expected: Migration applied successfully.

- [ ] **Step 5: Run typecheck**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd ~/projects/llamenos-hotline-contact-directory
git add src/server/db/schema/contacts.ts src/server/db/schema/index.ts drizzle/migrations/
git commit -m "feat(schema): add contacts, relationships, and link tables"
```

---

### Task 4: ContactService — Core CRUD

**Files:**
- Create: `src/server/services/contacts.ts`
- Create: `src/server/services/contacts.test.ts`
- Modify: `src/server/services/index.ts`

- [ ] **Step 1: Write failing test for createContact**

Create `src/server/services/contacts.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import type { Ciphertext } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { initDb } from '../db'
import { CryptoService } from '../lib/crypto-service'
import { ContactService } from './contacts'

const TEST_DB_URL = process.env.DATABASE_URL || 'postgres://localhost:5433/llamenos_test'
const db = initDb(TEST_DB_URL)
const crypto = new CryptoService(
  '0'.repeat(64), // test server secret
  '1'.repeat(64)  // test hmac secret
)
const service = new ContactService(db, crypto)

// Test helpers
const testHubId = `test-hub-contacts-${Date.now()}`
const testPubkey = '02' + 'a'.repeat(62)
const mockEnvelopes: RecipientEnvelope[] = [
  { pubkey: testPubkey, wrappedKey: 'wrapped', ephemeralPubkey: '02' + 'b'.repeat(62) },
]

describe('ContactService', () => {
  describe('createContact', () => {
    test('creates a contact with Tier 1 encrypted fields', async () => {
      const contact = await service.createContact({
        hubId: testHubId,
        contactType: 'caller',
        riskLevel: 'medium',
        tags: ['repeat-caller'],
        encryptedDisplayName: 'encrypted-display' as Ciphertext,
        displayNameEnvelopes: mockEnvelopes,
        encryptedNotes: 'encrypted-notes' as Ciphertext,
        notesEnvelopes: mockEnvelopes,
        createdBy: testPubkey,
      })

      expect(contact.id).toBeTruthy()
      expect(contact.hubId).toBe(testHubId)
      expect(contact.contactType).toBe('caller')
      expect(contact.riskLevel).toBe('medium')
      expect(contact.tags).toEqual(['repeat-caller'])
      expect(contact.encryptedDisplayName).toBe('encrypted-display')
      expect(contact.displayNameEnvelopes).toHaveLength(1)
    })

    test('creates a contact with Tier 2 encrypted fields and identifierHash', async () => {
      const contact = await service.createContact({
        hubId: testHubId,
        contactType: 'caller',
        riskLevel: 'low',
        tags: [],
        encryptedDisplayName: 'encrypted-display2' as Ciphertext,
        displayNameEnvelopes: mockEnvelopes,
        encryptedFullName: 'encrypted-fullname' as Ciphertext,
        fullNameEnvelopes: mockEnvelopes,
        encryptedPhone: 'encrypted-phone' as Ciphertext,
        phoneEnvelopes: mockEnvelopes,
        identifierHash: crypto.hmac('+15551234567', 'llamenos:phone:'),
        encryptedPII: 'encrypted-pii-blob' as Ciphertext,
        piiEnvelopes: mockEnvelopes,
        createdBy: testPubkey,
      })

      expect(contact.identifierHash).toBeTruthy()
      expect(contact.encryptedFullName).toBe('encrypted-fullname')
      expect(contact.encryptedPII).toBe('encrypted-pii-blob')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun test src/server/services/contacts.test.ts`
Expected: FAIL — `ContactService` not found

- [ ] **Step 3: Implement ContactService core CRUD**

Create `src/server/services/contacts.ts`:

```typescript
import { and, desc, eq, inArray } from 'drizzle-orm'
import { HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import type { Database } from '../db'
import {
  contactCallLinks,
  contactConversationLinks,
  contactRelationships,
  contacts,
} from '../db/schema/contacts'
import type { CryptoService } from '../lib/crypto-service'

export interface CreateContactInput {
  hubId: string
  contactType: string
  riskLevel: string
  tags: string[]
  identifierHash?: HmacHash
  // Tier 1
  encryptedDisplayName: Ciphertext
  displayNameEnvelopes: RecipientEnvelope[]
  encryptedNotes?: Ciphertext
  notesEnvelopes?: RecipientEnvelope[]
  // Tier 2 per-field
  encryptedFullName?: Ciphertext
  fullNameEnvelopes?: RecipientEnvelope[]
  encryptedPhone?: Ciphertext
  phoneEnvelopes?: RecipientEnvelope[]
  // Tier 2 blob
  encryptedPII?: Ciphertext
  piiEnvelopes?: RecipientEnvelope[]
  createdBy: string
}

export interface UpdateContactInput {
  contactType?: string
  riskLevel?: string
  tags?: string[]
  identifierHash?: HmacHash
  // Tier 1
  encryptedDisplayName?: Ciphertext
  displayNameEnvelopes?: RecipientEnvelope[]
  encryptedNotes?: Ciphertext
  notesEnvelopes?: RecipientEnvelope[]
  // Tier 2 per-field
  encryptedFullName?: Ciphertext
  fullNameEnvelopes?: RecipientEnvelope[]
  encryptedPhone?: Ciphertext
  phoneEnvelopes?: RecipientEnvelope[]
  // Tier 2 blob
  encryptedPII?: Ciphertext
  piiEnvelopes?: RecipientEnvelope[]
}

export class ContactService {
  constructor(
    protected readonly db: Database,
    protected readonly crypto: CryptoService
  ) {}

  async createContact(input: CreateContactInput) {
    const id = crypto.randomUUID()
    const now = new Date()

    const [row] = await this.db
      .insert(contacts)
      .values({
        id,
        hubId: input.hubId,
        contactType: input.contactType,
        riskLevel: input.riskLevel,
        tags: input.tags,
        identifierHash: input.identifierHash ?? null,
        encryptedDisplayName: input.encryptedDisplayName,
        displayNameEnvelopes: input.displayNameEnvelopes,
        encryptedNotes: input.encryptedNotes ?? null,
        notesEnvelopes: input.notesEnvelopes ?? [],
        encryptedFullName: input.encryptedFullName ?? null,
        fullNameEnvelopes: input.fullNameEnvelopes ?? [],
        encryptedPhone: input.encryptedPhone ?? null,
        phoneEnvelopes: input.phoneEnvelopes ?? [],
        encryptedPII: input.encryptedPII ?? null,
        piiEnvelopes: input.piiEnvelopes ?? [],
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return row
  }

  async getContact(id: string, hubId: string) {
    const rows = await this.db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.hubId, hubId)))
      .limit(1)

    return rows[0] ?? null
  }

  async listContacts(hubId: string, filters?: { contactType?: string; riskLevel?: string; tags?: string[] }) {
    const conditions = [eq(contacts.hubId, hubId)]

    if (filters?.contactType) {
      conditions.push(eq(contacts.contactType, filters.contactType))
    }
    if (filters?.riskLevel) {
      conditions.push(eq(contacts.riskLevel, filters.riskLevel))
    }

    const rows = await this.db
      .select()
      .from(contacts)
      .where(and(...conditions))
      .orderBy(desc(contacts.lastInteractionAt), desc(contacts.updatedAt))

    return rows
  }

  async updateContact(id: string, hubId: string, input: UpdateContactInput) {
    const values: Record<string, unknown> = { updatedAt: new Date() }

    if (input.contactType !== undefined) values.contactType = input.contactType
    if (input.riskLevel !== undefined) values.riskLevel = input.riskLevel
    if (input.tags !== undefined) values.tags = input.tags
    if (input.identifierHash !== undefined) values.identifierHash = input.identifierHash
    if (input.encryptedDisplayName !== undefined) values.encryptedDisplayName = input.encryptedDisplayName
    if (input.displayNameEnvelopes !== undefined) values.displayNameEnvelopes = input.displayNameEnvelopes
    if (input.encryptedNotes !== undefined) values.encryptedNotes = input.encryptedNotes
    if (input.notesEnvelopes !== undefined) values.notesEnvelopes = input.notesEnvelopes
    if (input.encryptedFullName !== undefined) values.encryptedFullName = input.encryptedFullName
    if (input.fullNameEnvelopes !== undefined) values.fullNameEnvelopes = input.fullNameEnvelopes
    if (input.encryptedPhone !== undefined) values.encryptedPhone = input.encryptedPhone
    if (input.phoneEnvelopes !== undefined) values.phoneEnvelopes = input.phoneEnvelopes
    if (input.encryptedPII !== undefined) values.encryptedPII = input.encryptedPII
    if (input.piiEnvelopes !== undefined) values.piiEnvelopes = input.piiEnvelopes

    const [row] = await this.db
      .update(contacts)
      .set(values)
      .where(and(eq(contacts.id, id), eq(contacts.hubId, hubId)))
      .returning()

    return row ?? null
  }

  async deleteContact(id: string, hubId: string) {
    const [row] = await this.db
      .delete(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.hubId, hubId)))
      .returning({ id: contacts.id })

    return !!row
  }

  // --- Dedup ---

  async checkDuplicate(identifierHash: HmacHash, hubId: string) {
    const rows = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.hubId, hubId), eq(contacts.identifierHash, identifierHash)))
      .limit(1)

    return rows[0] ? { exists: true, contactId: rows[0].id } : { exists: false }
  }

  // --- Auto-linking ---

  async findByIdentifierHash(identifierHash: HmacHash, hubId: string) {
    const rows = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.hubId, hubId), eq(contacts.identifierHash, identifierHash)))
      .limit(1)

    return rows[0]?.id ?? null
  }

  async linkCall(contactId: string, callId: string, hubId: string, linkedBy: string) {
    const id = crypto.randomUUID()
    await this.db.insert(contactCallLinks).values({
      id,
      hubId,
      contactId,
      callId,
      linkedBy,
    })
    // Update lastInteractionAt
    await this.db
      .update(contacts)
      .set({ lastInteractionAt: new Date() })
      .where(eq(contacts.id, contactId))
  }

  async linkConversation(contactId: string, conversationId: string, hubId: string, linkedBy: string) {
    const id = crypto.randomUUID()
    await this.db.insert(contactConversationLinks).values({
      id,
      hubId,
      contactId,
      conversationId,
      linkedBy,
    })
    await this.db
      .update(contacts)
      .set({ lastInteractionAt: new Date() })
      .where(eq(contacts.id, contactId))
  }

  async unlinkCall(contactId: string, callId: string) {
    await this.db
      .delete(contactCallLinks)
      .where(and(eq(contactCallLinks.contactId, contactId), eq(contactCallLinks.callId, callId)))
  }

  async unlinkConversation(contactId: string, conversationId: string) {
    await this.db
      .delete(contactConversationLinks)
      .where(
        and(
          eq(contactConversationLinks.contactId, contactId),
          eq(contactConversationLinks.conversationId, conversationId)
        )
      )
  }

  // --- Relationships ---

  async createRelationship(input: {
    hubId: string
    encryptedPayload: Ciphertext
    payloadEnvelopes: RecipientEnvelope[]
    createdBy: string
  }) {
    const id = crypto.randomUUID()
    const [row] = await this.db
      .insert(contactRelationships)
      .values({
        id,
        hubId: input.hubId,
        encryptedPayload: input.encryptedPayload,
        payloadEnvelopes: input.payloadEnvelopes,
        createdBy: input.createdBy,
      })
      .returning()

    return row
  }

  async listRelationships(hubId: string) {
    return this.db
      .select()
      .from(contactRelationships)
      .where(eq(contactRelationships.hubId, hubId))
  }

  async deleteRelationship(id: string, hubId: string) {
    const [row] = await this.db
      .delete(contactRelationships)
      .where(and(eq(contactRelationships.id, id), eq(contactRelationships.hubId, hubId)))
      .returning({ id: contactRelationships.id })

    return !!row
  }

  // --- Timeline ---

  async getLinkedCallIds(contactId: string) {
    const rows = await this.db
      .select({ callId: contactCallLinks.callId, linkedBy: contactCallLinks.linkedBy, createdAt: contactCallLinks.createdAt })
      .from(contactCallLinks)
      .where(eq(contactCallLinks.contactId, contactId))

    return rows
  }

  async getLinkedConversationIds(contactId: string) {
    const rows = await this.db
      .select({ conversationId: contactConversationLinks.conversationId, linkedBy: contactConversationLinks.linkedBy, createdAt: contactConversationLinks.createdAt })
      .from(contactConversationLinks)
      .where(eq(contactConversationLinks.contactId, contactId))

    return rows
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun test src/server/services/contacts.test.ts`
Expected: PASS (requires backing services: `bun run dev:docker`)

- [ ] **Step 5: Add more tests — list, update, delete, dedup, linking**

Add to `contacts.test.ts`:

```typescript
  describe('listContacts', () => {
    test('lists contacts filtered by hub', async () => {
      const list = await service.listContacts(testHubId)
      expect(list.length).toBeGreaterThanOrEqual(2) // from createContact tests
    })

    test('filters by contactType', async () => {
      const callers = await service.listContacts(testHubId, { contactType: 'caller' })
      for (const c of callers) {
        expect(c.contactType).toBe('caller')
      }
    })
  })

  describe('updateContact', () => {
    test('updates plaintext and encrypted fields', async () => {
      const list = await service.listContacts(testHubId)
      const contactId = list[0].id

      const updated = await service.updateContact(contactId, testHubId, {
        riskLevel: 'critical',
        tags: ['updated-tag'],
        encryptedDisplayName: 'updated-display' as Ciphertext,
        displayNameEnvelopes: mockEnvelopes,
      })

      expect(updated).not.toBeNull()
      expect(updated!.riskLevel).toBe('critical')
      expect(updated!.tags).toEqual(['updated-tag'])
    })
  })

  describe('deleteContact', () => {
    test('deletes a contact', async () => {
      const created = await service.createContact({
        hubId: testHubId,
        contactType: 'other',
        riskLevel: 'low',
        tags: [],
        encryptedDisplayName: 'to-delete' as Ciphertext,
        displayNameEnvelopes: mockEnvelopes,
        createdBy: testPubkey,
      })

      const deleted = await service.deleteContact(created.id, testHubId)
      expect(deleted).toBe(true)

      const found = await service.getContact(created.id, testHubId)
      expect(found).toBeNull()
    })
  })

  describe('checkDuplicate', () => {
    test('finds duplicate by identifierHash', async () => {
      const hash = crypto.hmac('+15559999999', 'llamenos:phone:')
      await service.createContact({
        hubId: testHubId,
        contactType: 'caller',
        riskLevel: 'low',
        tags: [],
        identifierHash: hash,
        encryptedDisplayName: 'dedup-test' as Ciphertext,
        displayNameEnvelopes: mockEnvelopes,
        createdBy: testPubkey,
      })

      const result = await service.checkDuplicate(hash, testHubId)
      expect(result.exists).toBe(true)
      expect(result.contactId).toBeTruthy()
    })

    test('returns false for unknown hash', async () => {
      const hash = crypto.hmac('+15550000000', 'llamenos:phone:')
      const result = await service.checkDuplicate(hash, testHubId)
      expect(result.exists).toBe(false)
    })
  })

  describe('relationships', () => {
    test('creates and lists relationships', async () => {
      const rel = await service.createRelationship({
        hubId: testHubId,
        encryptedPayload: 'encrypted-relationship' as Ciphertext,
        payloadEnvelopes: mockEnvelopes,
        createdBy: testPubkey,
      })

      expect(rel.id).toBeTruthy()
      expect(rel.encryptedPayload).toBe('encrypted-relationship')

      const list = await service.listRelationships(testHubId)
      expect(list.length).toBeGreaterThanOrEqual(1)
    })

    test('deletes a relationship', async () => {
      const rel = await service.createRelationship({
        hubId: testHubId,
        encryptedPayload: 'to-delete-rel' as Ciphertext,
        payloadEnvelopes: mockEnvelopes,
        createdBy: testPubkey,
      })

      const deleted = await service.deleteRelationship(rel.id, testHubId)
      expect(deleted).toBe(true)
    })
  })

  describe('linking', () => {
    test('links and unlinks a call', async () => {
      const contact = await service.createContact({
        hubId: testHubId,
        contactType: 'caller',
        riskLevel: 'low',
        tags: [],
        encryptedDisplayName: 'link-test' as Ciphertext,
        displayNameEnvelopes: mockEnvelopes,
        createdBy: testPubkey,
      })

      await service.linkCall(contact.id, 'call-123', testHubId, 'auto')
      const links = await service.getLinkedCallIds(contact.id)
      expect(links).toHaveLength(1)
      expect(links[0].callId).toBe('call-123')
      expect(links[0].linkedBy).toBe('auto')

      await service.unlinkCall(contact.id, 'call-123')
      const linksAfter = await service.getLinkedCallIds(contact.id)
      expect(linksAfter).toHaveLength(0)
    })
  })
```

- [ ] **Step 6: Run all tests**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun test src/server/services/contacts.test.ts`
Expected: All PASS

- [ ] **Step 7: Register in Services**

Modify `src/server/services/index.ts`:

Add import:
```typescript
import { ContactService } from './contacts'
```

Add to `Services` interface:
```typescript
  contacts: ContactService
```

Add to `createServices` return:
```typescript
    contacts: new ContactService(db, crypto),
```

Add to type exports:
```typescript
export type { ContactService }
```

- [ ] **Step 8: Run typecheck and build**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
cd ~/projects/llamenos-hotline-contact-directory
git add src/server/services/contacts.ts src/server/services/contacts.test.ts src/server/services/index.ts
git commit -m "feat(service): add ContactService with CRUD, dedup, linking, and relationships"
```

---

### Task 5: API Routes

**Files:**
- Modify: `src/server/routes/contacts.ts`

- [ ] **Step 1: Write API integration tests**

Create `tests/api/contacts-directory.spec.ts`:

```typescript
import { expect, test } from '@playwright/test'
import { ADMIN_NSEC } from '../helpers'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'

test.describe('Contact Directory API', () => {
  test.describe.configure({ mode: 'serial' })

  let createdContactId: string

  test('POST /api/contacts creates a contact', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post('/api/contacts', {
      contactType: 'caller',
      riskLevel: 'medium',
      tags: ['test-contact'],
      encryptedDisplayName: 'test-encrypted-display',
      displayNameEnvelopes: [],
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    expect(data.id).toBeTruthy()
    expect(data.contactType).toBe('caller')
    createdContactId = data.id
  })

  test('GET /api/contacts lists contacts', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.get('/api/contacts')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.contacts)).toBe(true)
    expect(data.contacts.length).toBeGreaterThanOrEqual(1)
  })

  test('GET /api/contacts/:id returns a single contact', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.get(`/api/contacts/${createdContactId}`)
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.id).toBe(createdContactId)
  })

  test('PATCH /api/contacts/:id updates a contact', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.patch(`/api/contacts/${createdContactId}`, {
      riskLevel: 'high',
      tags: ['updated'],
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.riskLevel).toBe('high')
  })

  test('GET /api/contacts/:id/timeline returns timeline', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.get(`/api/contacts/${createdContactId}/timeline`)
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('calls')
    expect(data).toHaveProperty('conversations')
    expect(data).toHaveProperty('notes')
  })

  test('POST /api/contacts/:id/link links a call', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post(`/api/contacts/${createdContactId}/link`, {
      type: 'call',
      targetId: 'test-call-id',
    })
    expect(res.status()).toBe(200)
  })

  test('GET /api/contacts/check-duplicate returns false for unknown hash', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.get('/api/contacts/check-duplicate?identifierHash=unknown-hash&hubId=global')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.exists).toBe(false)
  })

  test('POST /api/contacts/relationships creates a relationship', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post('/api/contacts/relationships', {
      encryptedPayload: 'test-encrypted-rel',
      payloadEnvelopes: [],
    })
    expect(res.status()).toBe(201)
    const data = await res.json()
    expect(data.id).toBeTruthy()
  })

  test('GET /api/contacts/relationships lists relationships', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.get('/api/contacts/relationships')
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data)).toBe(true)
  })

  test('DELETE /api/contacts/:id deletes a contact', async ({ request }) => {
    const api = createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.delete(`/api/contacts/${createdContactId}`)
    expect(res.status()).toBe(200)
  })

  test('rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/contacts')
    expect(res.status()).toBe(401)
  })
})
```

- [ ] **Step 2: Replace contacts route**

Rewrite `src/server/routes/contacts.ts`:

```typescript
import { Hono } from 'hono'
import type { Ciphertext, HmacHash } from '@shared/crypto-types'
import type { RecipientEnvelope } from '@shared/types'
import { checkPermission, requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const contacts = new Hono<AppEnv>()

// All contact endpoints require at least read-summary
contacts.use('*', requirePermission('contacts:read-summary'))

// GET /contacts — list contacts
contacts.get('/', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const contactType = c.req.query('contactType')
  const riskLevel = c.req.query('riskLevel')

  const list = await services.contacts.listContacts(hubId, {
    contactType: contactType || undefined,
    riskLevel: riskLevel || undefined,
  })

  return c.json({ contacts: list, total: list.length })
})

// GET /contacts/check-duplicate — dedup check
contacts.get('/check-duplicate', async (c) => {
  const services = c.get('services')
  const identifierHash = c.req.query('identifierHash')
  const hubId = c.req.query('hubId') ?? c.get('hubId') ?? 'global'

  if (!identifierHash) return c.json({ error: 'identifierHash required' }, 400)

  const result = await services.contacts.checkDuplicate(identifierHash as HmacHash, hubId)
  return c.json(result)
})

// GET /contacts/relationships — all relationships for hub
contacts.get('/relationships', requirePermission('contacts:read-pii'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'

  const relationships = await services.contacts.listRelationships(hubId)
  return c.json(relationships)
})

// POST /contacts/relationships — create relationship
contacts.post('/relationships', requirePermission('contacts:create'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const body = await c.req.json<{
    encryptedPayload: string
    payloadEnvelopes: RecipientEnvelope[]
  }>()

  const rel = await services.contacts.createRelationship({
    hubId,
    encryptedPayload: body.encryptedPayload as Ciphertext,
    payloadEnvelopes: body.payloadEnvelopes,
    createdBy: pubkey,
  })

  return c.json(rel, 201)
})

// DELETE /contacts/relationships/:id — delete relationship
contacts.delete('/relationships/:id', requirePermission('contacts:delete'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')

  const deleted = await services.contacts.deleteRelationship(id, hubId)
  if (!deleted) return c.json({ error: 'Not found' }, 404)

  return c.json({ ok: true })
})

// GET /contacts/:id — single contact
contacts.get('/:id', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')

  const contact = await services.contacts.getContact(id, hubId)
  if (!contact) return c.json({ error: 'Not found' }, 404)

  return c.json(contact)
})

// POST /contacts — create contact
contacts.post('/', requirePermission('contacts:create'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const pubkey = c.get('pubkey')
  const body = await c.req.json<{
    contactType: string
    riskLevel: string
    tags: string[]
    identifierHash?: string
    encryptedDisplayName: string
    displayNameEnvelopes: RecipientEnvelope[]
    encryptedNotes?: string
    notesEnvelopes?: RecipientEnvelope[]
    encryptedFullName?: string
    fullNameEnvelopes?: RecipientEnvelope[]
    encryptedPhone?: string
    phoneEnvelopes?: RecipientEnvelope[]
    encryptedPII?: string
    piiEnvelopes?: RecipientEnvelope[]
  }>()

  const contact = await services.contacts.createContact({
    hubId,
    contactType: body.contactType,
    riskLevel: body.riskLevel,
    tags: body.tags ?? [],
    identifierHash: (body.identifierHash as HmacHash) ?? undefined,
    encryptedDisplayName: body.encryptedDisplayName as Ciphertext,
    displayNameEnvelopes: body.displayNameEnvelopes ?? [],
    encryptedNotes: (body.encryptedNotes as Ciphertext) ?? undefined,
    notesEnvelopes: body.notesEnvelopes,
    encryptedFullName: (body.encryptedFullName as Ciphertext) ?? undefined,
    fullNameEnvelopes: body.fullNameEnvelopes,
    encryptedPhone: (body.encryptedPhone as Ciphertext) ?? undefined,
    phoneEnvelopes: body.phoneEnvelopes,
    encryptedPII: (body.encryptedPII as Ciphertext) ?? undefined,
    piiEnvelopes: body.piiEnvelopes,
    createdBy: pubkey,
  })

  return c.json(contact, 201)
})

// PATCH /contacts/:id — update contact
contacts.patch('/:id', async (c) => {
  const permissions = c.get('permissions')
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')
  const body = await c.req.json<Record<string, unknown>>()

  // Check which tier is being updated
  const hasSummaryFields = body.encryptedDisplayName || body.encryptedNotes || body.contactType || body.riskLevel || body.tags
  const hasPIIFields = body.encryptedFullName || body.encryptedPhone || body.encryptedPII

  if (hasSummaryFields && !checkPermission(permissions, 'contacts:update-summary')) {
    return c.json({ error: 'Forbidden: contacts:update-summary required' }, 403)
  }
  if (hasPIIFields && !checkPermission(permissions, 'contacts:update-pii')) {
    return c.json({ error: 'Forbidden: contacts:update-pii required' }, 403)
  }

  const updated = await services.contacts.updateContact(id, hubId, body as Record<string, unknown>)
  if (!updated) return c.json({ error: 'Not found' }, 404)

  return c.json(updated)
})

// DELETE /contacts/:id — delete contact
contacts.delete('/:id', requirePermission('contacts:delete'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const id = c.req.param('id')

  const deleted = await services.contacts.deleteContact(id, hubId)
  if (!deleted) return c.json({ error: 'Not found' }, 404)

  return c.json({ ok: true })
})

// GET /contacts/:id/timeline — unified timeline
contacts.get('/:id/timeline', async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const contactId = c.req.param('id')

  const contact = await services.contacts.getContact(contactId, hubId)
  if (!contact) return c.json({ error: 'Not found' }, 404)

  const [callLinks, conversationLinks] = await Promise.all([
    services.contacts.getLinkedCallIds(contactId),
    services.contacts.getLinkedConversationIds(contactId),
  ])

  // Fetch linked call records
  const callIds = callLinks.map((l) => l.callId)
  const calls = callIds.length > 0
    ? await services.records.getCallRecordsByIds(callIds, hubId)
    : []

  // Fetch linked conversations
  const conversationIds = conversationLinks.map((l) => l.conversationId)
  const conversations = conversationIds.length > 0
    ? await services.conversations.getConversationsByIds(conversationIds, hubId)
    : []

  // Fetch notes linked to this contact via identifierHash
  const notes = contact.identifierHash
    ? await services.records.getContactNotes(contact.identifierHash, hubId)
    : []

  return c.json({ calls, conversations, notes })
})

// POST /contacts/:id/link — manually link
contacts.post('/:id/link', requirePermission('contacts:link'), async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const contactId = c.req.param('id')
  const pubkey = c.get('pubkey')
  const body = await c.req.json<{ type: 'call' | 'conversation'; targetId: string }>()

  if (body.type === 'call') {
    await services.contacts.linkCall(contactId, body.targetId, hubId, pubkey)
  } else if (body.type === 'conversation') {
    await services.contacts.linkConversation(contactId, body.targetId, hubId, pubkey)
  } else {
    return c.json({ error: 'Invalid link type' }, 400)
  }

  return c.json({ ok: true })
})

// DELETE /contacts/:id/link — unlink
contacts.delete('/:id/link', requirePermission('contacts:link'), async (c) => {
  const services = c.get('services')
  const contactId = c.req.param('id')
  const body = await c.req.json<{ type: 'call' | 'conversation'; targetId: string }>()

  if (body.type === 'call') {
    await services.contacts.unlinkCall(contactId, body.targetId)
  } else if (body.type === 'conversation') {
    await services.contacts.unlinkConversation(contactId, body.targetId)
  }

  return c.json({ ok: true })
})

export default contacts
```

- [ ] **Step 3: Add helper methods to RecordsService and ConversationService if missing**

Check if `getCallRecordsByIds` and `getConversationsByIds` exist. If not, add them:

To `src/server/services/records.ts`:
```typescript
  async getCallRecordsByIds(ids: string[], hubId: string) {
    if (ids.length === 0) return []
    return this.db
      .select()
      .from(callRecords)
      .where(and(eq(callRecords.hubId, hubId), inArray(callRecords.id, ids)))
      .orderBy(desc(callRecords.startedAt))
  }
```

To `src/server/services/conversations.ts`:
```typescript
  async getConversationsByIds(ids: string[], hubId: string) {
    if (ids.length === 0) return []
    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.hubId, hubId), inArray(conversations.id, ids)))
      .orderBy(desc(conversations.lastMessageAt))
    return rows
  }
```

- [ ] **Step 4: Run typecheck and build**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 5: Run API tests**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bunx playwright test tests/api/contacts-directory.spec.ts`
Expected: All PASS (requires dev server + backing services running)

- [ ] **Step 6: Commit**

```bash
cd ~/projects/llamenos-hotline-contact-directory
git add src/server/routes/contacts.ts tests/api/contacts-directory.spec.ts src/server/services/records.ts src/server/services/conversations.ts
git commit -m "feat(api): replace contacts route with full CRUD, relationships, timeline, and linking"
```

---

### Task 6: Client API Functions

**Files:**
- Modify: `src/client/lib/api.ts`

- [ ] **Step 1: Add contact API functions**

Add to `src/client/lib/api.ts`:

```typescript
// --- Contacts ---

export interface ContactRecord {
  id: string
  hubId: string
  contactType: string
  riskLevel: string
  tags: string[]
  identifierHash: string | null
  encryptedDisplayName: string
  displayNameEnvelopes: RecipientEnvelope[]
  encryptedNotes: string | null
  notesEnvelopes: RecipientEnvelope[]
  encryptedFullName: string | null
  fullNameEnvelopes: RecipientEnvelope[]
  encryptedPhone: string | null
  phoneEnvelopes: RecipientEnvelope[]
  encryptedPII: string | null
  piiEnvelopes: RecipientEnvelope[]
  createdBy: string
  createdAt: string
  updatedAt: string
  lastInteractionAt: string | null
}

export interface ContactRelationshipRecord {
  id: string
  hubId: string
  encryptedPayload: string
  payloadEnvelopes: RecipientEnvelope[]
  createdBy: string
  createdAt: string
}

export async function listContacts(filters?: {
  contactType?: string
  riskLevel?: string
}): Promise<{ contacts: ContactRecord[]; total: number }> {
  const params = new URLSearchParams()
  if (filters?.contactType) params.set('contactType', filters.contactType)
  if (filters?.riskLevel) params.set('riskLevel', filters.riskLevel)
  const qs = params.toString()
  return request(hp(`/contacts${qs ? `?${qs}` : ''}`))
}

export async function getContact(id: string): Promise<ContactRecord> {
  return request(hp(`/contacts/${id}`))
}

export async function createContact(data: {
  contactType: string
  riskLevel: string
  tags: string[]
  identifierHash?: string
  encryptedDisplayName: string
  displayNameEnvelopes: RecipientEnvelope[]
  encryptedNotes?: string
  notesEnvelopes?: RecipientEnvelope[]
  encryptedFullName?: string
  fullNameEnvelopes?: RecipientEnvelope[]
  encryptedPhone?: string
  phoneEnvelopes?: RecipientEnvelope[]
  encryptedPII?: string
  piiEnvelopes?: RecipientEnvelope[]
}): Promise<ContactRecord> {
  return request(hp('/contacts'), { method: 'POST', body: JSON.stringify(data) })
}

export async function updateContact(
  id: string,
  data: Record<string, unknown>
): Promise<ContactRecord> {
  return request(hp(`/contacts/${id}`), { method: 'PATCH', body: JSON.stringify(data) })
}

export async function deleteContact(id: string): Promise<void> {
  return request(hp(`/contacts/${id}`), { method: 'DELETE' })
}

export async function getContactTimeline(id: string): Promise<{
  calls: unknown[]
  conversations: unknown[]
  notes: unknown[]
}> {
  return request(hp(`/contacts/${id}/timeline`))
}

export async function linkToContact(
  contactId: string,
  type: 'call' | 'conversation',
  targetId: string
): Promise<void> {
  return request(hp(`/contacts/${contactId}/link`), {
    method: 'POST',
    body: JSON.stringify({ type, targetId }),
  })
}

export async function checkContactDuplicate(identifierHash: string): Promise<{
  exists: boolean
  contactId?: string
}> {
  return request(hp(`/contacts/check-duplicate?identifierHash=${encodeURIComponent(identifierHash)}`))
}

export async function listContactRelationships(): Promise<ContactRelationshipRecord[]> {
  return request(hp('/contacts/relationships'))
}

export async function createContactRelationship(data: {
  encryptedPayload: string
  payloadEnvelopes: RecipientEnvelope[]
}): Promise<ContactRelationshipRecord> {
  return request(hp('/contacts/relationships'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deleteContactRelationship(id: string): Promise<void> {
  return request(hp(`/contacts/relationships/${id}`), { method: 'DELETE' })
}
```

- [ ] **Step 2: Add RecipientEnvelope import if not already present**

Ensure `import type { RecipientEnvelope } from '@shared/types'` is at the top of `api.ts`.

- [ ] **Step 3: Run typecheck**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd ~/projects/llamenos-hotline-contact-directory
git add src/client/lib/api.ts
git commit -m "feat(client): add contact directory API functions"
```

---

### Task 7: i18n Keys

**Files:**
- Modify: `src/client/locales/en.json` (and 12 other locale files)

- [ ] **Step 1: Add contact i18n keys to en.json**

Add a `"contacts"` namespace to `en.json`:

```json
  "contacts": {
    "title": "Contacts",
    "newContact": "New Contact",
    "search": "Search contacts...",
    "noContacts": "No contacts yet",
    "type": "Type",
    "riskLevel": "Risk Level",
    "tags": "Tags",
    "lastInteraction": "Last Interaction",
    "displayName": "Display Name",
    "notes": "Notes",
    "languages": "Languages",
    "fullName": "Full Name",
    "phone": "Phone",
    "email": "Email",
    "address": "Address",
    "dateOfBirth": "Date of Birth",
    "identifiers": "External IDs",
    "supportContacts": "Support Contacts",
    "supportContactFor": "Support Contact For",
    "relationship": "Relationship",
    "emergency": "Emergency",
    "addSupportContact": "Add Support Contact",
    "timeline": "Timeline",
    "summary": "Summary",
    "pii": "Personal Information",
    "piiEncrypted": "Encrypted — requires authorized access",
    "createTitle": "Create Contact",
    "editTitle": "Edit Contact",
    "deleteConfirm": "Are you sure you want to delete this contact?",
    "deleted": "Contact deleted",
    "created": "Contact created",
    "updated": "Contact updated",
    "linkCall": "Link Call",
    "linkConversation": "Link Conversation",
    "unlink": "Unlink",
    "linkedBy": "Linked by",
    "autoLinked": "Auto-linked",
    "manuallyLinked": "Manually linked",
    "knownContact": "Known contact",
    "duplicateWarning": "A contact with this phone number may already exist",
    "viewExisting": "View Existing",
    "createAnyway": "Create Anyway",
    "contactField": "Contact",
    "contactsField": "Contacts",
    "selectContact": "Select a contact...",
    "caller": "Caller",
    "partnerOrg": "Partner Org",
    "referralResource": "Referral Resource",
    "other": "Other",
    "low": "Low",
    "medium": "Medium",
    "high": "High",
    "critical": "Critical"
  }
```

- [ ] **Step 2: Add placeholder keys to other 12 locale files**

Copy the same keys to all other locale files (`es.json`, `zh.json`, `tl.json`, `vi.json`, `ar.json`, `fr.json`, `ht.json`, `ko.json`, `ru.json`, `hi.json`, `pt.json`, `de.json`). Use the English values as placeholders — these will be translated later.

- [ ] **Step 3: Run typecheck**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd ~/projects/llamenos-hotline-contact-directory
git add src/client/locales/
git commit -m "feat(i18n): add contact directory translation keys"
```

---

### Task 8: Contact Directory Page (Frontend)

**Files:**
- Create: `src/client/routes/contacts.tsx`

- [ ] **Step 1: Create contact directory route**

Create `src/client/routes/contacts.tsx`:

```typescript
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth'
import {
  type ContactRecord,
  listContacts,
} from '@/lib/api'
import { tryDecryptField } from '@/lib/envelope-field-crypto'
import { LABEL_CONTACT_SUMMARY } from '@shared/crypto-labels'
import { BookUser, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreateContactDialog } from '@/components/contacts/create-contact-dialog'
import { toast } from 'sonner'

type ContactsSearch = {
  contactType: string
  riskLevel: string
  q: string
}

export const Route = createFileRoute('/contacts')({
  validateSearch: (search: Record<string, unknown>): ContactsSearch => ({
    contactType: (search?.contactType as string) || '',
    riskLevel: (search?.riskLevel as string) || '',
    q: (search?.q as string) || '',
  }),
  component: ContactDirectoryPage,
})

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-500/10 text-green-500 border-green-500/20',
  medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  high: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-500 border-red-500/20',
}

function ContactDirectoryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate({ from: '/contacts' })
  const { contactType, riskLevel, q } = Route.useSearch()
  const { hasNsec } = useAuth()

  const [contacts, setContacts] = useState<ContactRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)

  const fetchContacts = useCallback(() => {
    setLoading(true)
    listContacts({
      contactType: contactType || undefined,
      riskLevel: riskLevel || undefined,
    })
      .then((r) => setContacts(r.contacts))
      .catch(() => toast.error(t('common.error')))
      .finally(() => setLoading(false))
  }, [contactType, riskLevel, t])

  useEffect(() => {
    fetchContacts()
  }, [fetchContacts])

  // Client-side search on decrypted display names
  const filteredContacts = useMemo(() => {
    if (!q) return contacts
    const lower = q.toLowerCase()
    return contacts.filter((c) => {
      const name = tryDecryptField(
        c.encryptedDisplayName,
        c.displayNameEnvelopes,
        '',
        LABEL_CONTACT_SUMMARY
      )
      return name.toLowerCase().includes(lower)
    })
  }, [contacts, q])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BookUser className="h-5 w-5" />
        <h1 className="text-xl font-semibold">{t('contacts.title')}</h1>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Input
              placeholder={t('contacts.search')}
              value={q}
              onChange={(e) =>
                navigate({ search: (prev) => ({ ...prev, q: e.target.value }) })
              }
              className="sm:max-w-xs"
              data-testid="contacts-search"
            />
            <Select
              value={contactType}
              onValueChange={(v) =>
                navigate({ search: (prev) => ({ ...prev, contactType: v === 'all' ? '' : v }) })
              }
            >
              <SelectTrigger className="w-40" data-testid="contacts-type-filter">
                <SelectValue placeholder={t('contacts.type')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="caller">{t('contacts.caller')}</SelectItem>
                <SelectItem value="partner-org">{t('contacts.partnerOrg')}</SelectItem>
                <SelectItem value="referral-resource">{t('contacts.referralResource')}</SelectItem>
                <SelectItem value="other">{t('contacts.other')}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={riskLevel}
              onValueChange={(v) =>
                navigate({ search: (prev) => ({ ...prev, riskLevel: v === 'all' ? '' : v }) })
              }
            >
              <SelectTrigger className="w-40" data-testid="contacts-risk-filter">
                <SelectValue placeholder={t('contacts.riskLevel')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="low">{t('contacts.low')}</SelectItem>
                <SelectItem value="medium">{t('contacts.medium')}</SelectItem>
                <SelectItem value="high">{t('contacts.high')}</SelectItem>
                <SelectItem value="critical">{t('contacts.critical')}</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto">
              <Button onClick={() => setCreateOpen(true)} data-testid="contacts-create-btn">
                <Plus className="mr-1 h-4 w-4" />
                {t('contacts.newContact')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              {t('contacts.noContacts')}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredContacts.map((contact) => (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  onClick={() => navigate({ to: '/contacts/$contactId', params: { contactId: contact.id } })}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateContactDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false)
          fetchContacts()
        }}
      />
    </div>
  )
}

function ContactRow({ contact, onClick }: { contact: ContactRecord; onClick: () => void }) {
  const { t } = useTranslation()

  const displayName = tryDecryptField(
    contact.encryptedDisplayName,
    contact.displayNameEnvelopes,
    '[encrypted]',
    LABEL_CONTACT_SUMMARY
  )

  const riskClass = RISK_COLORS[contact.riskLevel] ?? ''

  return (
    <div
      className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 cursor-pointer hover:bg-muted/30 transition-colors"
      onClick={onClick}
      data-testid={`contact-row-${contact.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{displayName}</div>
        <div className="text-xs text-muted-foreground">
          {contact.lastInteractionAt
            ? new Date(contact.lastInteractionAt).toLocaleDateString()
            : t('contacts.noContacts')}
        </div>
      </div>
      <Badge variant="outline" className="text-xs">
        {t(`contacts.${contact.contactType === 'partner-org' ? 'partnerOrg' : contact.contactType === 'referral-resource' ? 'referralResource' : contact.contactType}`)}
      </Badge>
      <Badge variant="outline" className={`text-xs ${riskClass}`}>
        {t(`contacts.${contact.riskLevel}`)}
      </Badge>
      <div className="flex gap-1">
        {contact.tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs">
            {tag}
          </Badge>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck and build**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run typecheck && bun run build`
Expected: PASS (CreateContactDialog will be stubbed in next task)

- [ ] **Step 3: Commit**

```bash
cd ~/projects/llamenos-hotline-contact-directory
git add src/client/routes/contacts.tsx
git commit -m "feat(ui): add contact directory page with search and filters"
```

---

### Task 9: Create Contact Dialog

**Files:**
- Create: `src/client/components/contacts/create-contact-dialog.tsx`

- [ ] **Step 1: Create the dialog component**

Create `src/client/components/contacts/create-contact-dialog.tsx`:

```typescript
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PhoneInput } from '@/components/phone-input'
import { useAuth } from '@/lib/auth'
import {
  checkContactDuplicate,
  createContact,
  type ContactRecord,
} from '@/lib/api'
import { ClientCryptoService } from '@/lib/crypto-service'
import * as keyManager from '@/lib/key-manager'
import { LABEL_CONTACT_SUMMARY, LABEL_CONTACT_PII, HMAC_PHONE_PREFIX } from '@shared/crypto-labels'
import type { RecipientEnvelope } from '@shared/types'
import { Loader2, Lock, AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (contact: ContactRecord) => void
}

export function CreateContactDialog({ open, onOpenChange, onCreated }: Props) {
  const { t } = useTranslation()
  const { publicKey, hasPermission } = useAuth()

  const [saving, setSaving] = useState(false)
  const [duplicate, setDuplicate] = useState<{ exists: boolean; contactId?: string } | null>(null)

  // Tier 1 fields
  const [displayName, setDisplayName] = useState('')
  const [contactType, setContactType] = useState('caller')
  const [riskLevel, setRiskLevel] = useState('low')
  const [tags, setTags] = useState('')
  const [notes, setNotes] = useState('')

  // Tier 2 fields (shown by permission)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')

  const canEditPII = hasPermission('contacts:update-pii') || hasPermission('contacts:*')

  function reset() {
    setDisplayName('')
    setContactType('caller')
    setRiskLevel('low')
    setTags('')
    setNotes('')
    setFullName('')
    setPhone('')
    setDuplicate(null)
  }

  async function handlePhoneBlur() {
    if (!phone) return
    try {
      // Client-side HMAC for dedup check
      const sk = keyManager.getSecretKey()
      const pk = keyManager.getPublicKeyHex()
      if (!pk) return
      const crypto = new ClientCryptoService(sk, pk)
      const hash = crypto.hmac(phone, HMAC_PHONE_PREFIX)
      const result = await checkContactDuplicate(hash)
      setDuplicate(result)
    } catch {
      // Ignore dedup check failures
    }
  }

  async function handleSubmit() {
    if (!displayName.trim()) return
    if (!keyManager.isUnlocked()) {
      toast.error(t('common.keyRequired'))
      return
    }

    setSaving(true)
    try {
      const sk = keyManager.getSecretKey()
      const pk = keyManager.getPublicKeyHex()!
      const crypto = new ClientCryptoService(sk, pk)

      // Get recipient pubkeys for each tier from the volunteers list + roles
      // The server exposes volunteer pubkeys and their roles via GET /api/volunteers
      // Resolve which pubkeys have contacts:read-summary and contacts:read-pii
      // by checking their role permissions (using resolveHubPermissions from shared/permissions)
      const volunteers = await listVolunteers()
      const roles = await getRoles()
      const summaryRecipients = volunteers
        .filter((v) => hasPermissionForVolunteer(v, roles, 'contacts:read-summary'))
        .map((v) => v.pubkey)
      const piiRecipients = volunteers
        .filter((v) => hasPermissionForVolunteer(v, roles, 'contacts:read-pii'))
        .map((v) => v.pubkey)
      // Always include the creator
      if (!summaryRecipients.includes(pk)) summaryRecipients.push(pk)
      if (!piiRecipients.includes(pk)) piiRecipients.push(pk)

      // Encrypt Tier 1
      const { encrypted: encDisplayName, envelopes: displayNameEnvelopes } =
        crypto.envelopeEncrypt(displayName, summaryRecipients, LABEL_CONTACT_SUMMARY)

      let encNotes: string | undefined
      let notesEnvelopes: RecipientEnvelope[] | undefined
      if (notes.trim()) {
        const result = crypto.envelopeEncrypt(
          JSON.stringify({ notes: notes.trim(), languages: [] }),
          summaryRecipients,
          LABEL_CONTACT_SUMMARY
        )
        encNotes = result.encrypted
        notesEnvelopes = result.envelopes
      }

      // Encrypt Tier 2 (if provided)
      let encFullName: string | undefined
      let fullNameEnvelopes: RecipientEnvelope[] | undefined
      let encPhone: string | undefined
      let phoneEnvelopes: RecipientEnvelope[] | undefined
      let identifierHash: string | undefined

      if (fullName.trim()) {
        const result = crypto.envelopeEncrypt(fullName, piiRecipients, LABEL_CONTACT_PII)
        encFullName = result.encrypted
        fullNameEnvelopes = result.envelopes
      }

      if (phone.trim()) {
        const result = crypto.envelopeEncrypt(phone, piiRecipients, LABEL_CONTACT_PII)
        encPhone = result.encrypted
        phoneEnvelopes = result.envelopes
        identifierHash = crypto.hmac(phone, HMAC_PHONE_PREFIX)
      }

      const parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      const contact = await createContact({
        contactType,
        riskLevel,
        tags: parsedTags,
        identifierHash,
        encryptedDisplayName: encDisplayName,
        displayNameEnvelopes,
        encryptedNotes: encNotes,
        notesEnvelopes,
        encryptedFullName: encFullName,
        fullNameEnvelopes,
        encryptedPhone: encPhone,
        phoneEnvelopes,
      })

      toast.success(t('contacts.created'))
      reset()
      onCreated(contact)
    } catch (err) {
      toast.error(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {t('contacts.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Tier 1 — Summary */}
          <div className="space-y-3">
            <div>
              <Label>{t('contacts.displayName')} *</Label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('contacts.displayName')}
                data-testid="contact-display-name"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('contacts.type')}</Label>
                <Select value={contactType} onValueChange={setContactType}>
                  <SelectTrigger data-testid="contact-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="caller">{t('contacts.caller')}</SelectItem>
                    <SelectItem value="partner-org">{t('contacts.partnerOrg')}</SelectItem>
                    <SelectItem value="referral-resource">{t('contacts.referralResource')}</SelectItem>
                    <SelectItem value="other">{t('contacts.other')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('contacts.riskLevel')}</Label>
                <Select value={riskLevel} onValueChange={setRiskLevel}>
                  <SelectTrigger data-testid="contact-risk">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{t('contacts.low')}</SelectItem>
                    <SelectItem value="medium">{t('contacts.medium')}</SelectItem>
                    <SelectItem value="high">{t('contacts.high')}</SelectItem>
                    <SelectItem value="critical">{t('contacts.critical')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>{t('contacts.tags')}</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="comma, separated, tags"
                data-testid="contact-tags"
              />
            </div>

            <div>
              <Label>{t('contacts.notes')}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('contacts.notes')}
                rows={3}
                data-testid="contact-notes"
              />
            </div>
          </div>

          {/* Tier 2 — PII (shown by permission) */}
          {canEditPII && (
            <div className="space-y-3 border-t pt-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Lock className="h-3 w-3" />
                {t('contacts.pii')}
              </div>
              <div>
                <Label>{t('contacts.fullName')}</Label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t('contacts.fullName')}
                  data-testid="contact-full-name"
                />
              </div>
              <div>
                <Label>{t('contacts.phone')}</Label>
                <PhoneInput
                  value={phone}
                  onChange={setPhone}
                  onBlur={handlePhoneBlur}
                  data-testid="contact-phone"
                />
              </div>

              {duplicate?.exists && (
                <div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <span>{t('contacts.duplicateWarning')}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !displayName.trim()}
            data-testid="contact-submit"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Run typecheck and build**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd ~/projects/llamenos-hotline-contact-directory
git add src/client/components/contacts/create-contact-dialog.tsx
git commit -m "feat(ui): add create contact dialog with E2EE envelope encryption"
```

---

### Task 10: Contact Profile Page

**Files:**
- Create: `src/client/routes/contacts.$contactId.tsx`
- Create: `src/client/components/contacts/contact-timeline.tsx`
- Create: `src/client/components/contacts/contact-relationship-section.tsx`

- [ ] **Step 1: Create contact timeline component**

Create `src/client/components/contacts/contact-timeline.tsx`:

```typescript
import { Badge } from '@/components/ui/badge'
import { Phone, MessageSquare, FileText, ClipboardList } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface TimelineEntry {
  type: 'call' | 'conversation' | 'note' | 'report'
  id: string
  timestamp: string
  summary: string
}

interface Props {
  calls: unknown[]
  conversations: unknown[]
  notes: unknown[]
}

const ICONS = {
  call: Phone,
  conversation: MessageSquare,
  note: FileText,
  report: ClipboardList,
}

const COLORS = {
  call: 'text-blue-400',
  conversation: 'text-purple-400',
  note: 'text-green-400',
  report: 'text-yellow-400',
}

export function ContactTimeline({ calls, conversations, notes }: Props) {
  const { t } = useTranslation()

  // Merge all entries into a unified timeline sorted by timestamp
  const entries: TimelineEntry[] = [
    ...(calls as Array<{ id: string; startedAt: string; status: string; duration?: number }>).map(
      (c) => ({
        type: 'call' as const,
        id: c.id,
        timestamp: c.startedAt,
        summary: `${c.status}${c.duration ? ` · ${Math.round(c.duration / 60)}m` : ''}`,
      })
    ),
    ...(conversations as Array<{ id: string; createdAt: string; channelType: string; messageCount: number }>).map(
      (c) => ({
        type: 'conversation' as const,
        id: c.id,
        timestamp: c.createdAt,
        summary: `${c.channelType} · ${c.messageCount} messages`,
      })
    ),
    ...(notes as Array<{ id: string; createdAt: string }>).map((n) => ({
      type: 'note' as const,
      id: n.id,
      timestamp: n.createdAt,
      summary: '', // Notes are encrypted — summary would require decryption
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  if (entries.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {t('contacts.noContacts')}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {entries.map((entry) => {
        const Icon = ICONS[entry.type]
        const color = COLORS[entry.type]
        return (
          <div
            key={`${entry.type}-${entry.id}`}
            className="flex items-start gap-3 rounded-md px-3 py-2 hover:bg-muted/30 transition-colors cursor-pointer"
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {entry.type}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.timestamp).toLocaleString()}
                </span>
              </div>
              {entry.summary && (
                <div className="mt-0.5 text-sm text-muted-foreground">{entry.summary}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Create relationship section component**

Create `src/client/components/contacts/contact-relationship-section.tsx`:

```typescript
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ContactRelationshipRecord } from '@/lib/api'
import { tryDecryptField } from '@/lib/envelope-field-crypto'
import { LABEL_CONTACT_RELATIONSHIP } from '@shared/crypto-labels'
import type { RelationshipPayload } from '@shared/types'
import { AlertTriangle, Link as LinkIcon, UserPlus } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  contactId: string
  relationships: ContactRelationshipRecord[]
  contactNames: Map<string, string> // contactId → decrypted display name
  onNavigate: (contactId: string) => void
}

export function ContactRelationshipSection({
  contactId,
  relationships,
  contactNames,
  onNavigate,
}: Props) {
  const { t } = useTranslation()

  // Decrypt relationship payloads and separate into forward/reverse
  const { forward, reverse } = useMemo(() => {
    const fwd: Array<{ id: string; payload: RelationshipPayload }> = []
    const rev: Array<{ id: string; payload: RelationshipPayload }> = []

    for (const rel of relationships) {
      const decrypted = tryDecryptField(
        rel.encryptedPayload,
        rel.payloadEnvelopes,
        '',
        LABEL_CONTACT_RELATIONSHIP
      )
      if (!decrypted) continue

      try {
        const payload: RelationshipPayload = JSON.parse(decrypted)
        if (payload.fromContactId === contactId) {
          fwd.push({ id: rel.id, payload })
        } else if (payload.toContactId === contactId) {
          rev.push({ id: rel.id, payload })
        }
      } catch {
        // Skip malformed payloads
      }
    }

    return { forward: fwd, reverse: rev }
  }, [relationships, contactId])

  if (forward.length === 0 && reverse.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-2">
        {t('contacts.noContacts')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Forward: this contact's support contacts */}
      {forward.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase mb-1">
            {t('contacts.supportContacts')}
          </div>
          {forward.map(({ id, payload }) => (
            <div
              key={id}
              className="flex items-center justify-between py-1.5 cursor-pointer hover:bg-muted/30 rounded px-2 transition-colors"
              onClick={() => onNavigate(payload.toContactId)}
            >
              <div className="flex items-center gap-2">
                <LinkIcon className="h-3 w-3 text-muted-foreground" />
                <span className="text-sm">
                  {contactNames.get(payload.toContactId) ?? '[encrypted]'}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({payload.relationship})
                </span>
              </div>
              {payload.isEmergency && (
                <Badge variant="destructive" className="text-xs">
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  {t('contacts.emergency')}
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reverse: contacts this person supports */}
      {reverse.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase mb-1">
            {t('contacts.supportContactFor')}
          </div>
          {reverse.map(({ id, payload }) => (
            <div
              key={id}
              className="flex items-center justify-between py-1.5 cursor-pointer hover:bg-muted/30 rounded px-2 transition-colors"
              onClick={() => onNavigate(payload.fromContactId)}
            >
              <div className="flex items-center gap-2">
                <LinkIcon className="h-3 w-3 text-muted-foreground" />
                <span className="text-sm">
                  {contactNames.get(payload.fromContactId) ?? '[encrypted]'}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({payload.relationship})
                </span>
              </div>
              {payload.isEmergency && (
                <Badge variant="destructive" className="text-xs">
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  {t('contacts.emergency')}
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create contact profile page**

Create `src/client/routes/contacts.$contactId.tsx`:

```typescript
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ContactTimeline } from '@/components/contacts/contact-timeline'
import { ContactRelationshipSection } from '@/components/contacts/contact-relationship-section'
import { useAuth } from '@/lib/auth'
import {
  type ContactRecord,
  type ContactRelationshipRecord,
  deleteContact,
  getContact,
  getContactTimeline,
  listContactRelationships,
  listContacts,
} from '@/lib/api'
import { tryDecryptField } from '@/lib/envelope-field-crypto'
import {
  LABEL_CONTACT_SUMMARY,
  LABEL_CONTACT_PII,
} from '@shared/crypto-labels'
import {
  ArrowLeft,
  BookUser,
  Lock,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export const Route = createFileRoute('/contacts/$contactId')({
  component: ContactProfilePage,
})

function ContactProfilePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { contactId } = Route.useParams()
  const { hasPermission } = useAuth()

  const [contact, setContact] = useState<ContactRecord | null>(null)
  const [timeline, setTimeline] = useState<{ calls: unknown[]; conversations: unknown[]; notes: unknown[] } | null>(null)
  const [relationships, setRelationships] = useState<ContactRelationshipRecord[]>([])
  const [contactNames, setContactNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const canReadPII = hasPermission('contacts:read-pii') || hasPermission('contacts:*')
  const canDelete = hasPermission('contacts:delete') || hasPermission('contacts:*')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [c, tl, rels, allContacts] = await Promise.all([
        getContact(contactId),
        getContactTimeline(contactId),
        listContactRelationships(),
        listContacts(),
      ])
      setContact(c)
      setTimeline(tl)
      setRelationships(rels)

      // Build contact name lookup for relationships
      const names = new Map<string, string>()
      for (const ct of allContacts.contacts) {
        const name = tryDecryptField(
          ct.encryptedDisplayName,
          ct.displayNameEnvelopes,
          '[encrypted]',
          LABEL_CONTACT_SUMMARY
        )
        names.set(ct.id, name)
      }
      setContactNames(names)
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [contactId, t])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-[350px_1fr]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    )
  }

  if (!contact) {
    return <div className="py-12 text-center text-muted-foreground">Contact not found</div>
  }

  const displayName = tryDecryptField(
    contact.encryptedDisplayName,
    contact.displayNameEnvelopes,
    '[encrypted]',
    LABEL_CONTACT_SUMMARY
  )

  const notesDecrypted = tryDecryptField(
    contact.encryptedNotes,
    contact.notesEnvelopes,
    '',
    LABEL_CONTACT_SUMMARY
  )

  const fullName = canReadPII
    ? tryDecryptField(contact.encryptedFullName, contact.fullNameEnvelopes, '', LABEL_CONTACT_PII)
    : null

  const phone = canReadPII
    ? tryDecryptField(contact.encryptedPhone, contact.phoneEnvelopes, '', LABEL_CONTACT_PII)
    : null

  const RISK_COLORS: Record<string, string> = {
    low: 'bg-green-500/10 text-green-500',
    medium: 'bg-yellow-500/10 text-yellow-500',
    high: 'bg-orange-500/10 text-orange-500',
    critical: 'bg-red-500/10 text-red-500',
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: '/contacts' })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <BookUser className="h-5 w-5" />
          <h1 className="text-xl font-semibold">{displayName}</h1>
          <Badge variant="outline" className={RISK_COLORS[contact.riskLevel] ?? ''}>
            {t(`contacts.${contact.riskLevel}`)}
          </Badge>
        </div>
        <div className="flex gap-2">
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDeleteOpen(true)}
              data-testid="contact-delete-btn"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Main layout: sidebar + timeline */}
      <div className="grid gap-4 lg:grid-cols-[350px_1fr]">
        {/* Sidebar */}
        <div className="space-y-4">
          {/* Summary (Tier 1) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('contacts.summary')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">{t('contacts.type')}: </span>
                <Badge variant="outline">
                  {t(`contacts.${contact.contactType === 'partner-org' ? 'partnerOrg' : contact.contactType === 'referral-resource' ? 'referralResource' : contact.contactType}`)}
                </Badge>
              </div>
              {contact.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {contact.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
              {notesDecrypted && (
                <div>
                  <span className="text-muted-foreground">{t('contacts.notes')}: </span>
                  {notesDecrypted}
                </div>
              )}
            </CardContent>
          </Card>

          {/* PII (Tier 2) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Lock className="h-3 w-3" />
                {t('contacts.pii')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {canReadPII ? (
                <>
                  {fullName && (
                    <div>
                      <span className="text-muted-foreground">{t('contacts.fullName')}: </span>
                      {fullName}
                    </div>
                  )}
                  {phone && (
                    <div>
                      <span className="text-muted-foreground">{t('contacts.phone')}: </span>
                      {phone}
                    </div>
                  )}
                  {!fullName && !phone && (
                    <div className="text-muted-foreground">{t('contacts.noContacts')}</div>
                  )}
                </>
              ) : (
                <div className="text-muted-foreground">{t('contacts.piiEncrypted')}</div>
              )}
            </CardContent>
          </Card>

          {/* Support Contacts */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                {t('contacts.supportContacts')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ContactRelationshipSection
                contactId={contactId}
                relationships={relationships}
                contactNames={contactNames}
                onNavigate={(id) =>
                  navigate({ to: '/contacts/$contactId', params: { contactId: id } })
                }
              />
            </CardContent>
          </Card>
        </div>

        {/* Timeline */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t('contacts.timeline')}</CardTitle>
          </CardHeader>
          <CardContent>
            {timeline ? (
              <ContactTimeline
                calls={timeline.calls}
                conversations={timeline.conversations}
                notes={timeline.notes}
              />
            ) : (
              <Skeleton className="h-48" />
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('contacts.deleteConfirm')}
        variant="destructive"
        onConfirm={async () => {
          await deleteContact(contactId)
          toast.success(t('contacts.deleted'))
          navigate({ to: '/contacts' })
        }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run typecheck and build**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ~/projects/llamenos-hotline-contact-directory
git add src/client/routes/contacts.\$contactId.tsx src/client/components/contacts/contact-timeline.tsx src/client/components/contacts/contact-relationship-section.tsx
git commit -m "feat(ui): add contact profile page with sidebar, timeline, and relationships"
```

---

### Task 11: Contact Custom Field Picker

**Files:**
- Create: `src/client/components/contacts/contact-select.tsx`
- Modify: `src/client/components/notes/custom-field-inputs.tsx`

- [ ] **Step 1: Create ContactSelect component**

Create `src/client/components/contacts/contact-select.tsx`:

```typescript
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { type ContactRecord, listContacts } from '@/lib/api'
import { tryDecryptField } from '@/lib/envelope-field-crypto'
import { LABEL_CONTACT_SUMMARY } from '@shared/crypto-labels'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface ContactSelectProps {
  value: string | string[] | undefined
  onChange: (value: string | string[]) => void
  multiple?: boolean
  disabled?: boolean
}

export function ContactSelect({ value, onChange, multiple, disabled }: ContactSelectProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [contacts, setContacts] = useState<ContactRecord[]>([])

  useEffect(() => {
    listContacts().then((r) => setContacts(r.contacts)).catch(() => {})
  }, [])

  const contactMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of contacts) {
      const name = tryDecryptField(
        c.encryptedDisplayName,
        c.displayNameEnvelopes,
        '[encrypted]',
        LABEL_CONTACT_SUMMARY
      )
      map.set(c.id, name)
    }
    return map
  }, [contacts])

  const selected = multiple
    ? Array.isArray(value) ? value : value ? [value] : []
    : value ? [value as string] : []

  function toggle(id: string) {
    if (multiple) {
      const next = selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id]
      onChange(next)
    } else {
      onChange(id)
      setOpen(false)
    }
  }

  function remove(id: string) {
    if (multiple) {
      onChange(selected.filter((s) => s !== id))
    } else {
      onChange('')
    }
  }

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            disabled={disabled}
            className="w-full justify-between font-normal"
            data-testid="contact-select"
          >
            {selected.length === 0
              ? t('contacts.selectContact')
              : `${selected.length} selected`}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput placeholder={t('contacts.search')} />
            <CommandList>
              <CommandEmpty>{t('contacts.noContacts')}</CommandEmpty>
              <CommandGroup>
                {contacts.map((c) => {
                  const name = contactMap.get(c.id) ?? '[encrypted]'
                  const isSelected = selected.includes(c.id)
                  return (
                    <CommandItem
                      key={c.id}
                      value={name}
                      onSelect={() => toggle(c.id)}
                    >
                      <Check
                        className={cn('mr-2 h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')}
                      />
                      {name}
                      <Badge variant="outline" className="ml-auto text-xs">
                        {c.contactType}
                      </Badge>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected badges */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((id) => (
            <Badge key={id} variant="secondary" className="text-xs">
              {contactMap.get(id) ?? id.slice(0, 8)}
              <button
                type="button"
                className="ml-1 hover:text-destructive"
                onClick={() => remove(id)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add contact field type to CustomFieldInputs**

In `src/client/components/notes/custom-field-inputs.tsx`, add a case for `'contact'` and `'contacts'` field types in the render switch. Import `ContactSelect`:

```typescript
import { ContactSelect } from '@/components/contacts/contact-select'

// In the field type rendering switch, add:
case 'contact':
  return (
    <ContactSelect
      value={fieldValue as string | undefined}
      onChange={(v) => handleChange(field.id, v)}
      disabled={disabled}
    />
  )
case 'contacts':
  return (
    <ContactSelect
      value={fieldValue as string[] | undefined}
      onChange={(v) => handleChange(field.id, v)}
      multiple
      disabled={disabled}
    />
  )
```

- [ ] **Step 3: Run typecheck and build**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd ~/projects/llamenos-hotline-contact-directory
git add src/client/components/contacts/contact-select.tsx src/client/components/notes/custom-field-inputs.tsx
git commit -m "feat(ui): add contact select custom field type"
```

---

### Task 12: Auto-Linking in Call/Conversation Flow

**Files:**
- Modify: `src/server/services/calls.ts` (or the call routing handler)
- Modify: `src/server/services/conversations.ts`

- [ ] **Step 1: Add auto-linking to call routing**

In the call answering flow (where a new call record is created), add contact auto-linking. Find the point where a call record is inserted and add:

```typescript
// After inserting call record:
const contactId = await services.contacts.findByIdentifierHash(
  callerPhoneHash,
  hubId
)
if (contactId) {
  await services.contacts.linkCall(contactId, callRecord.id, hubId, 'auto')
}
```

- [ ] **Step 2: Add auto-linking to conversation creation**

In `ConversationService`, where a new conversation is created from an inbound message, add:

```typescript
// After creating conversation:
const contactId = await services.contacts.findByIdentifierHash(
  contactIdentifierHash as HmacHash,
  hubId
)
if (contactId) {
  await services.contacts.linkConversation(contactId, conversationId, hubId, 'auto')
}
```

Note: The `contacts` service needs to be accessible from the conversation service. Pass it via the services object or inject it as a dependency.

- [ ] **Step 3: Run typecheck and build**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd ~/projects/llamenos-hotline-contact-directory
git add src/server/services/calls.ts src/server/services/conversations.ts
git commit -m "feat(auto-link): auto-link inbound calls and conversations to contacts via phone HMAC"
```

---

### Task 13: Integration Testing & Final Verification

**Files:**
- Run all test suites

- [ ] **Step 1: Run unit tests**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun test`
Expected: All PASS

- [ ] **Step 2: Run typecheck and build**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run typecheck && bun run build`
Expected: PASS

- [ ] **Step 3: Run API integration tests**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bunx playwright test tests/api/contacts-directory.spec.ts`
Expected: All PASS

- [ ] **Step 4: Run full test suite**

Run: `cd ~/projects/llamenos-hotline-contact-directory && bun run test:all`
Expected: All PASS — no regressions

- [ ] **Step 5: Commit any fixes**

If any test fixes were needed, commit them:

```bash
cd ~/projects/llamenos-hotline-contact-directory
git add -A
git commit -m "fix: address test feedback from integration testing"
```

- [ ] **Step 6: Verify branch is ready for PR**

Run: `cd ~/projects/llamenos-hotline-contact-directory && git log --oneline feat/field-level-encryption..HEAD`

Review all commits are clean and meaningful.
