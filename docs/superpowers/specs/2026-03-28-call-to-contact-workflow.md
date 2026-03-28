> **Status: DRAFT — Needs Review.** Verify against codebase, check third-party docs, and review with user before writing implementation plan. May need revision after other specs land.

# Call-to-Contact Workflow — Design Spec

**Goal:** Enable users to create and link contacts directly from the call detail page, extract contact information from transcripts and notes, and add support contacts from call context — turning call data into structured contact records.

**Depends on:** Spec 0 (PBAC Redesign), Contact Directory v1 (PR #26).

---

## 1. Call Detail Page — Contact Actions

### When viewing a call record (`/calls/:callId`)

**If the call is already linked to a contact:**
- Show "Linked to: [display name]" with a clickable link to the contact profile
- "Unlink" action (requires `contacts:link`)

**If the call is NOT linked to a contact:**
- "Add as Contact" button → opens create contact dialog, pre-populated with:
  - `contactType: 'caller'`
  - Phone number (if decryptable from call record) → auto-fills phone field + triggers HMAC for `identifierHash`
  - The new contact is auto-linked to this call on creation
- "Link to Existing" button → opens a searchable contact picker (reuses `ContactSelect` component)
  - On selection, creates a `contact_call_links` row

### Permission gating

| Action | Permission |
|--------|-----------|
| See contact link/name | `contacts:read-own` or higher + `contacts:envelope-summary` |
| "Add as Contact" | `contacts:create` |
| "Link to Existing" | `contacts:link` |
| "Unlink" | `contacts:link` |

---

## 2. Notes — Contact Actions

### When viewing a note attached to a call

**"Add Support Contact" action** on each note:
- Opens a mini-form: display name, relationship, phone/channel, isEmergency checkbox
- Links the new support contact to the caller's contact record (creates contact + relationship)
- Pre-fills what it can from the note context

### When creating a new note

- The note form already supports custom fields including `contact` type
- Add a "Link to Contact" field that auto-populates if the call is linked to a contact

---

## 3. Transcript — Contact Extraction

### Lightweight pattern matching (not ML)

When a transcript is available, scan for:
- **Phone numbers**: regex for E.164, US formats, international formats
- **Names with relationship context**: patterns like "his sister Maria", "lawyer named [Name]", "call [Name] at [number]"
- **Addresses**: street number + street name patterns
- **Email addresses**: standard email regex

### Implementation

```typescript
interface ExtractedEntity {
  type: 'phone' | 'name' | 'email' | 'address'
  value: string
  context: string       // surrounding text snippet for review
  confidence: 'high' | 'medium' | 'low'
  startOffset: number
  endOffset: number
}

function extractContactEntities(text: string): ExtractedEntity[]
```

This runs **client-side** (the transcript is already decrypted in the browser). No server involvement — the extracted entities stay in browser memory until the user acts on them.

### Confidence levels

- **High**: E.164 phone number, standard email format
- **Medium**: US phone format (could be a case number), name near a relationship word
- **Low**: Possible name (capitalized word near "call", "contact", "tell")

### UI: Extraction panel

On the call detail page, when a transcript exists:
- "Extract Contact Info" button below the transcript
- Opens a side panel showing extracted entities grouped by type
- Each entity shows: the value, surrounding context, confidence badge
- Actions per entity:
  - "Add as Contact" → opens create dialog pre-filled
  - "Add as Support Contact" → adds to the linked caller's contact record
  - "Dismiss" → hides the suggestion

### Privacy: all client-side

The extraction happens entirely in the browser after transcript decryption. No plaintext data sent to the server. The user explicitly chooses which extracted entities to save (as encrypted contact records).

---

## 4. Post-Call Contact Creation Flow

### The typical volunteer workflow after a call

1. Call ends → volunteer is on the call detail page
2. If auto-linked: "Known contact: [alias]" banner shown
3. If not linked: "Add caller as contact?" prompt
4. Volunteer creates the contact (display name/alias, risk level, tags)
5. Volunteer writes notes (already linked to the call)
6. If the caller mentioned family/lawyer/org contacts: volunteer adds support contacts
7. Transcript extraction suggests additional contact info

### Streamlined UI

The call detail page becomes the hub for post-call work:
- **Contact card** (top of page): shows linked contact or "Add Contact" prompt
- **Notes section**: existing note creation with contact auto-link
- **Transcript panel**: with extraction button when available
- **Support contacts**: quick-add from the call context

---

## 5. API Additions

```
POST /api/contacts/from-call/:callId    → create contact + auto-link to call in one step
POST /api/contacts/:id/support-contact  → create support contact + relationship in one step
```

### `POST /api/contacts/from-call/:callId`

Convenience endpoint that:
1. Creates the contact (same body as `POST /api/contacts`)
2. Creates a `contact_call_links` row linking to the specified call
3. Returns the created contact

Requires: `contacts:create`

### `POST /api/contacts/:id/support-contact`

Convenience endpoint that:
1. Creates a new contact for the support person
2. Creates an encrypted relationship linking them to the parent contact
3. Returns both the new contact and the relationship

Body:
```typescript
{
  // New support contact fields
  contact: CreateContactInput
  // Relationship
  encryptedRelationshipPayload: string
  relationshipEnvelopes: RecipientEnvelope[]
}
```

Requires: `contacts:create`

---

## 6. Non-Goals

- ML-based entity extraction (future — current regex approach is sufficient for phone/email/name)
- Automatic contact creation from transcript (always user-initiated)
- Transcript search across contacts (future — would need an encrypted search index)
- Voice-to-contact during live call (post-call only)
