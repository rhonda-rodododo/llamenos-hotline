# Contact Directory v1 — Design Spec

**Goal:** Add a privacy-preserving contact directory for tracking recurring callers, partner organizations, referral resources, and support networks — with E2EE ensuring data is visible only to authorized roles. When a volunteer answers a matched call, the contact profile opens alongside notes for informed, contextual call handling.

**Use cases:** Jail support hotlines, ICE rapid response, crisis lines with repeat callers and partner org networks.

**Base branch:** `feat/field-level-encryption` — leverages `CryptoService`, branded `Ciphertext`/`HmacHash` types, `ciphertext()`/`hmacHashed()` column helpers, and client-side `decryptHubField()`/`tryDecryptField()` utilities.

---

## Security Model: E2EE Contact Encryption

All contact data is encrypted with ECIES envelopes. The server never decrypts contact data. No server-key fallback — E2EE only.

### Tier 1 — Summary (contacts:read-summary)

ECIES envelopes for all pubkeys with `contacts:read-summary` permission.

Contains:
- `displayName` — pseudonym or initials (never full real name unless creator chose)
- `notes` — brief status notes (max 500 chars)
- `languages` — known languages for routing hints

### Tier 2 — PII (contacts:read-pii)

ECIES envelopes for all pubkeys with `contacts:read-pii` permission.

Per-field encrypted:
- `fullName`
- `phoneNumbers: { label: string, number: string }[]` (primary drives `identifierHash`)

Blob encrypted (single `encryptedPII` payload):
- `emailAddresses: string[]`
- `address: string`
- `dateOfBirth: string`
- `identifiers: { label: string, value: string }[]` — external IDs (case numbers, shelter IDs)

### Relationships — Fully E2EE

Relationships between contacts (support contacts, org affiliations) are stored as opaque encrypted blobs. The server sees only "a relationship exists in this hub" — it cannot determine who is linked to whom, the relationship type, or emergency status.

Single encrypted payload per relationship:
```typescript
interface RelationshipPayload {
  fromContactId: string
  toContactId: string
  relationship: string    // "sister", "lawyer", "case worker"
  isEmergency: boolean
}
```

Client decrypts all relationships for the hub and reconstructs the graph in memory.

### Plaintext Fields (Server-Queryable)

These are intentionally plaintext to enable server-side filtering without revealing identity:
- `contactType` — `caller | partner-org | referral-resource | other`
- `riskLevel` — `low | medium | high | critical`
- `tags: string[]` — e.g. `["repeat-caller", "detained", "legal-aid"]`
- `identifierHash` — HMAC of primary phone number (for auto-linking and dedup)

Risk level and tags alone do not identify a person.

---

## Contact Types

```typescript
type ContactType = 'caller' | 'partner-org' | 'referral-resource' | 'other'
type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
```

---

## Data Model

### `contacts` table

```typescript
interface ContactsTable {
  id: string
  hubId: string

  // Plaintext (queryable)
  contactType: ContactType
  riskLevel: RiskLevel
  tags: string[]                              // JSONB
  identifierHash: HmacHash | null             // HMAC of primary phone

  // Tier 1 — per-field ECIES (contacts:read-summary recipients)
  encryptedDisplayName: Ciphertext
  displayNameEnvelopes: RecipientEnvelope[]
  encryptedNotes: Ciphertext | null
  notesEnvelopes: RecipientEnvelope[]

  // Tier 2 — per-field ECIES (contacts:read-pii recipients)
  encryptedFullName: Ciphertext | null
  fullNameEnvelopes: RecipientEnvelope[]
  encryptedPhone: Ciphertext | null
  phoneEnvelopes: RecipientEnvelope[]

  // Tier 2 — blob ECIES (contacts:read-pii recipients)
  encryptedPII: Ciphertext | null
  piiEnvelopes: RecipientEnvelope[]

  // Metadata
  createdBy: string                           // pubkey of creator
  createdAt: Date
  updatedAt: Date
  lastInteractionAt: Date | null
}
```

### `contact_relationships` table

```typescript
interface ContactRelationshipsTable {
  id: string
  hubId: string

  // Fully E2EE — server sees nothing
  encryptedPayload: Ciphertext                // RelationshipPayload JSON
  payloadEnvelopes: RecipientEnvelope[]       // contacts:read-pii recipients

  createdBy: string                           // pubkey
  createdAt: Date
}
```

### `contact_call_links` table

```typescript
interface ContactCallLinksTable {
  id: string
  hubId: string
  contactId: string
  callId: string
  linkedBy: string                            // pubkey or 'auto'
  createdAt: Date
}
```

### `contact_conversation_links` table

```typescript
interface ContactConversationLinksTable {
  id: string
  hubId: string
  contactId: string
  conversationId: string
  linkedBy: string                            // pubkey or 'auto'
  createdAt: Date
}
```

### Custom field type addition

Add `'contact' | 'contacts'` to the `fieldType` options on `customFieldDefinitions`. Values stored in note/report payloads as `contactId: string` (single) or `contactIds: string[]` (multi). The UI renders a searchable dropdown of contacts (Tier 1 display names).

---

## Permissions

### New permissions

| Permission | Description |
|---|---|
| `contacts:create` | Create new contacts and relationships |
| `contacts:read-summary` | Decrypt Tier 1 fields (display name, notes, tags, risk level) |
| `contacts:read-pii` | Decrypt Tier 2 fields (full name, phone, PII blob, relationships) |
| `contacts:update-summary` | Edit Tier 1 fields |
| `contacts:update-pii` | Edit Tier 2 fields |
| `contacts:delete` | Soft delete contacts |
| `contacts:link` | Manually link calls/conversations to contacts |

### Default role assignments

- **Hub Admin:** all contact permissions
- **Volunteer:** `contacts:create`, `contacts:read-summary`

Additional roles with any combination of contact permissions can be created by admins.

### Cryptographic enforcement

Permissions gate who receives ECIES envelopes. Even if the API leaks encrypted data, without the matching private key the data cannot be decrypted:
- Tier 1 envelopes → all pubkeys with `contacts:read-summary`
- Tier 2 envelopes → all pubkeys with `contacts:read-pii`
- Relationship envelopes → all pubkeys with `contacts:read-pii`

When a role gains or loses a contact permission, envelopes must be re-wrapped for affected contacts (same pattern as hub key rotation on member departure).

---

## Auto-Linking Calls & Conversations to Contacts

When an inbound call or message arrives:

1. Server HMACs the caller/sender phone number with `HMAC_PHONE_PREFIX`
2. Queries `contacts WHERE identifierHash = $hash AND hubId = $hubId`
3. If match: creates a `contact_call_links` or `contact_conversation_links` row with `linkedBy = 'auto'`
4. Real-time Nostr event notifies connected clients: incoming interaction matched a known contact
5. Volunteer's UI shows "Known contact: [displayName]" (client decrypts Tier 1)

No new crypto labels needed — phone HMAC uses existing `HMAC_PHONE_PREFIX` from `crypto-labels.ts`.

---

## Dedup Flow

On contact creation (client-side):

1. Client HMACs the phone number locally
2. Calls `GET /api/contacts/check-duplicate?identifierHash=$hash&hubId=$hubId`
3. If match: shows "Possible existing contact: [displayName]" with option to view existing or create anyway
4. Hub setting `enforcePhoneDedup` (default: false): when true, blocks creation and forces linking to existing contact
5. If no match or user proceeds: `POST /api/contacts` with encrypted payload

---

## API Design

```
GET    /api/contacts                         → list (paginated, Tier 1 + Tier 2 encrypted fields returned, client decrypts what it can)
GET    /api/contacts/:id                     → single contact (all encrypted fields)
POST   /api/contacts                         → create (encrypted payload from client)
PATCH  /api/contacts/:id                     → update (re-encrypted fields from client)
DELETE /api/contacts/:id                     → soft delete (permission-gated)

GET    /api/contacts/:id/timeline            → unified timeline (calls, conversations, notes, reports linked to this contact)
POST   /api/contacts/:id/link                → manually link { type: 'call' | 'conversation' | 'report', targetId: string }
DELETE /api/contacts/:id/link                → unlink

GET    /api/contacts/relationships           → all relationships for hub (client decrypts, filters in memory)
POST   /api/contacts/relationships           → create relationship (encrypted payload)
DELETE /api/contacts/relationships/:id       → delete relationship

GET    /api/contacts/check-duplicate         → pass identifierHash, returns { exists: boolean, contactId?: string }
```

The server returns encrypted blobs for all contact data. It never decrypts. Client-side search/filter on decrypted display names and notes. Server-side filtering limited to plaintext columns: `contactType`, `riskLevel`, `tags`, `hubId`.

---

## Frontend

### Contact Directory Page (`/contacts`)

**Layout:** Table view with search bar and filters.

- **Search bar:** client-side search on decrypted display names and notes
- **Filters:** contactType, riskLevel, tags (server-side filterable)
- **Table columns:** Display Name, Type, Risk Level, Tags, Last Interaction
- **Row action:** click → navigate to contact profile
- **New Contact button:** opens create dialog

### Contact Profile Page (`/contacts/:id`)

**Layout:** Sidebar + Timeline (responsive — stacked on mobile).

**Left sidebar (info panels):**
- Summary section (Tier 1): display name, type, risk level, tags, notes, languages
  - Editable inline for users with `contacts:update-summary`
- PII section (Tier 2): full name, phone numbers, email, address, DOB, identifiers
  - Shows "Encrypted — requires authorized access" for users without `contacts:read-pii`
  - Editable for users with `contacts:update-pii`
- Support Contacts section (Tier 2): list of related contacts with relationship type, emergency badge
  - Clickable → navigate to that contact's profile
  - Shows both forward ("support contacts for this person") and reverse ("this person is a support contact for...")

**Right panel (timeline):**
- Unified chronological timeline of all linked interactions
- Color-coded by type: calls, notes, reports, messages
- Each entry shows: type, timestamp, brief summary (decrypted client-side)
- Click entry → navigate to full call/note/report/conversation detail

### Create Contact Dialog

- Tier 1 fields shown to all roles: display name, contact type, risk level, tags, notes, languages
- Tier 2 fields shown by permission: full name, phone number(s), email, address, DOB, identifiers
- Phone number field → client HMACs for dedup check before submit
- Dedup warning shown if match found (configurable to block)

### Call Integration

When a volunteer answers a call matched to a known contact:
- Contact profile opens alongside the note-taking screen
- Volunteer sees display name, risk level, tags, notes, and recent timeline
- Notes created during the call are automatically linked to the contact

---

## Implementation Notes: Reusable Components & Patterns

### Existing Components to Reuse

- **PhoneInput** (`components/phone-input.tsx`) — international phone input with validation and country selector. Use for contact phone number entry.
- **ConfirmDialog** (`components/confirm-dialog.tsx`) — async-capable confirmation dialog. Use for delete contact, remove relationship.
- **CustomFieldInputs** (`components/notes/custom-field-inputs.tsx`) — renders all custom field types with validation. Extend to support `'contact' | 'contacts'` field type.
- **VolunteerMultiSelect** (`components/volunteer-multi-select.tsx`) — searchable multi-select with badges. Follow this pattern for the contact picker (new `ContactSelect` / `ContactMultiSelect` components).
- **SettingsSection** (`components/settings-section.tsx`) — collapsible card with copy-link. Use for profile sidebar sections (Summary, PII, Support Contacts).
- **ChannelBadge** (`components/ChannelBadge.tsx`) — channel type + encryption status badge. Use in timeline entries.
- **CommandPalette** (`components/command-palette.tsx`) — global Cmd+K search. Add contact search results.
- **FileUpload/FilePreview** (`components/FileUpload.tsx`, `components/FilePreview.tsx`) — encrypted file handling. Available if contacts need attachments.
- **ErrorBoundary** (`components/error-boundary.tsx`) — wrap contact pages.

### Design System

- **Tailwind CSS v4** with `@theme` block defining OKLch color tokens in `app.css`
- **shadcn/ui** (new-york style) — 22 primitives in `components/ui/` including Card, Dialog, Sheet, Badge, Input, Select, Checkbox, Switch, Tooltip, ScrollArea, Command, Popover
- **lucide-react** icons
- **Font:** DM Sans for headings, system-ui fallback

### UI Patterns to Follow

- **List rendering:** `divide-y divide-border` with `hover:bg-muted/30 transition-colors` rows (see calls page)
- **Responsive:** `flex flex-col` + `sm:flex-row` breakpoints
- **Badge variants:** `<Badge variant="outline">` for tags, `<Badge variant="secondary">` for types, destructive for risk
- **Text hierarchy:** `text-sm text-muted-foreground` for secondary, `font-medium` for primary
- **Loading states:** `<Skeleton>` component for placeholder UI
- **i18n:** every user-facing string via `useTranslation()` — add contact-related keys to all 13 locale files
- **Encryption UI:** check `keyManager.isUnlocked()` before decrypt, show lock indicator when locked, use `tryDecryptField()` for graceful fallback
- **Data attributes:** `data-testid` on interactive elements for E2E test stability

### Crypto Labels

New labels needed in `crypto-labels.ts`:
- `LABEL_CONTACT_SUMMARY = 'llamenos:contact-summary'` — Tier 1 envelope encryption
- `LABEL_CONTACT_PII = 'llamenos:contact-pii'` — Tier 2 envelope encryption
- `LABEL_CONTACT_RELATIONSHIP = 'llamenos:contact-relationship'` — relationship payload encryption

Existing label reused:
- `HMAC_PHONE_PREFIX` — phone number hashing for `identifierHash`

---

## Non-Goals (Future)

- Contact import/export CSV
- Contact merging UI (dedup warns but doesn't merge)
- Cross-hub contact sharing
- Bulk operations
- Duplicate detection beyond phone HMAC (name similarity, etc.)
