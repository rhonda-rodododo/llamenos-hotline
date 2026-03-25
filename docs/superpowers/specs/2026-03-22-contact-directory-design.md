# Contact Directory — Design Spec

**Goal:** Add a privacy-preserving contact directory where admins and volunteers can maintain records of recurring callers, partner organizations, and at-risk individuals — with multi-tier encryption ensuring PII is visible only to authorized roles.

**Backport source:** v2 at `~/projects/llamenos` — `src/client/routes/contacts-directory.tsx`, `src/client/components/contacts/contact-profile.tsx`, `src/client/components/contacts/create-contact-dialog.tsx`.

**Scope:** Crisis hotlines often have repeat callers, partner orgs (hospitals, shelters), and individuals requiring ongoing monitoring. A contact directory with role-based visibility allows informed, private call handling.

---

## Security Model: Two-Tier Contact Encryption

### Tier 1 — Summary (Volunteer-visible)
Encrypted with the **hub key** (all members can decrypt).

Contains:
- `displayName` — pseudonym or initials (never full real name unless admin chose)
- `tags` — e.g. `["repeat-caller", "shelter-contact"]`
- `riskLevel` — `low | medium | high | critical`
- `notes` — brief status notes (max 500 chars)
- `languages` — known languages for routing hints
- `contactType` — `caller | partner | volunteer | other`
- `lastInteractionAt` — timestamp of most recent linked call/message

### Tier 2 — PII (Admin-only)
Encrypted with **admin ECIES envelopes** (one per admin pubkey, same pattern as note encryption).

Contains:
- `fullName`
- `phoneNumbers: { label: string, number: string }[]`
- `emailAddresses: string[]`
- `address`
- `dateOfBirth`
- `emergencyContacts: { name: string, phone: string, relationship: string }[]`
- `identifiers` — external IDs (case numbers, shelter IDs)

### Contact identifier (server-side linking)
- `identifierHash` — HMAC of phone number (with `LABEL_PHONE_HMAC` from `crypto-labels.ts`)
- Used to auto-match incoming calls to contacts without server seeing plaintext phone
- Stored plaintext (hash only) to enable lookup on call receipt

---

## Contact Types

```typescript
type ContactType = 'caller' | 'partner-org' | 'referral-resource' | 'other'
type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
```

---

## Relationships

Contacts can be linked to:
- **Calls**: `contact_call_links(contactId, callId)` — auto-populated when `identifierHash` matches inbound call
- **Cases**: `contact_case_links(contactId, caseId)` — see case management spec
- **Conversations**: `contact_conversation_links(contactId, conversationId)`

---

## Access Model

| Role | Can See | Can Do |
|------|---------|--------|
| Volunteer | Tier 1 (summary, tags, risk level, notes) | Read only, or with admin grant: create/edit summary |
| Admin | Tier 1 + Tier 2 (PII) | Full CRUD, link to calls/cases |
| Super Admin (if hub grants access) | Tier 1 only (PII not decryptable without hub key) | Read Tier 1 |

Tier 2 access is cryptographic — a volunteer without admin ECIES key simply cannot decrypt the PII fields even if they bypass the API.

---

## Contact Profile Schema

```typescript
// Stored in DB:
interface ContactRecord {
  id: string
  hubId: string
  identifierHash: string | null          // HMAC of primary phone, nullable

  // Tier 1 (hub key encrypted):
  encryptedSummary: string               // JSON payload encrypted with hub key
  summaryEnvelope: string                // Hub key envelope (same as message envelopes)

  // Tier 2 (admin ECIES per admin):
  encryptedPII: string | null            // JSON payload
  adminEnvelopes: { pubkey: string, envelope: string }[]

  contactType: ContactType
  riskLevel: RiskLevel                   // Stored plaintext for filtering! Is this OK?
  // NOTE: riskLevel in plaintext enables admin to filter "high risk" without decrypt.
  // Alternative: encrypt and lose filterability. Decision: plaintext is acceptable —
  // risk level alone doesn't identify a person.

  tags: string[]                         // Plaintext for filtering (no PII)
  createdAt: Date
  updatedAt: Date
  createdBy: string                      // Pubkey of creator
  lastInteractionAt: Date | null
}
```

---

## Auto-Linking Calls to Contacts

When an inbound call arrives:
1. Hash the caller's phone number with `LABEL_PHONE_HMAC`
2. Query `contacts WHERE identifierHash = $hash AND hubId = $hubId`
3. If match: include `contactId` in the call record (server-side, plaintext FK)
4. On call detail page: show "Known contact: [displayName]" (volunteer decrypts displayName from Tier 1)

---

## API Design

```
GET  /api/contacts                         → list (Tier 1 only, paginated)
GET  /api/contacts/:id                     → single (Tier 1 + Tier 2 if admin)
POST /api/contacts                         → create (admin; volunteers need explicit grant)
PATCH /api/contacts/:id                    → update (admin; volunteers can update Tier 1 only)
DELETE /api/contacts/:id                   → soft delete (admin)
GET  /api/contacts/:id/calls               → linked calls
GET  /api/contacts/:id/conversations       → linked conversations
POST /api/contacts/:id/link-call/:callId   → manually link call (admin)
```

---

## Frontend — Contact Directory Page

Route: `/contacts`

**Layout:**
- Search bar (searches `tags` and `displayName` — Tier 1 only)
- Filter: by type, risk level, tag
- Table/card grid: shows displayName, type, risk level badge, tags, last interaction
- Click row → Contact Profile panel/page

**Contact Profile (`/contacts/:id`):**
- Tier 1 section: display name, tags, risk level, notes, languages
  - Edit inline (volunteers if granted, admins always)
- Tier 2 section (admin only): full name, phone numbers, email, address, emergency contacts
  - Shows "PII is encrypted — viewing requires admin access" to non-admins
- Linked calls timeline
- Linked conversations

**Create Contact dialog:**
- Tier 1 fields (all roles)
- Tier 2 fields (admin only — shown/hidden by role)
- Phone number field → server HMAC's it automatically

---

## Non-Goals

- Contact import/export CSV (future)
- Duplicate detection (future)
- Contact merging (future)
- Sharing contacts across hubs (out of scope — each hub has independent contacts)
