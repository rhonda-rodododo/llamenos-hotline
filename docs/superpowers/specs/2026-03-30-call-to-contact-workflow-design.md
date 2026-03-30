# Call-to-Contact Workflow — Design Spec (Revised)

**Date:** 2026-03-30 (revised from 2026-03-28 original)
**Status:** Draft
**Scope:** Create and link contacts from the call detail page, extract contact info from transcripts, add support contacts from call context — turning call data into structured contact records.
**Depends on:** Contact Directory v1 (2026-03-30), PBAC Scope Hierarchy (2026-03-30)

---

## 1. Call Detail Page — Contact Actions

### When call is linked to a contact (auto or manual)

- "Linked to: [display name]" with clickable link to contact profile
- "Unlink" action (requires `contacts:link`)

### When call is NOT linked

- **"Add as Contact"** button → opens create contact dialog pre-populated with:
  - `contactType: 'caller'`
  - Phone number (if decryptable from call record) → auto-fills phone + triggers HMAC
  - New contact auto-linked to this call on creation
- **"Link to Existing"** button → opens `ContactSelect` component
  - On selection, creates `contact_call_links` row

### Permission gating

| Action | Permission Required |
|--------|-------------------|
| See contact link/name | `contacts:read-own` or higher + `contacts:envelope-summary` |
| "Add as Contact" | `contacts:create` |
| "Link to Existing" | `contacts:link` |
| "Unlink" | `contacts:link` |

---

## 2. Notes — Contact Actions

### "Add Support Contact" action on notes

Opens a mini-form: display name, relationship, phone/channel, isEmergency checkbox. Creates contact + relationship linked to the caller's contact record.

### Note creation — contact auto-link

The note form's "Link to Contact" field auto-populates if the call is linked to a contact.

---

## 3. Transcript — Contact Extraction

### Client-side pattern matching

When a transcript is available, scan for:
- **Phone numbers**: E.164, US formats, international formats
- **Names with relationship context**: "his sister Maria", "lawyer named [Name]"
- **Email addresses**: standard email regex

```typescript
interface ExtractedEntity {
  type: 'phone' | 'name' | 'email' | 'address'
  value: string
  context: string       // surrounding text snippet
  confidence: 'high' | 'medium' | 'low'
  startOffset: number
  endOffset: number
}

function extractContactEntities(text: string): ExtractedEntity[]
```

Runs **client-side** after transcript decryption. No server involvement — extracted entities stay in browser memory until the user acts.

### Extraction panel UI

"Extract Contact Info" button below the transcript:
- Side panel showing extracted entities grouped by type
- Confidence badges (high/medium/low)
- Actions per entity: "Add as Contact", "Add as Support Contact", "Dismiss"

### Privacy

Extraction happens entirely in the browser. No plaintext sent to the server. The user explicitly chooses which entities to save as encrypted contact records.

---

## 4. Post-Call Contact Creation Flow

Typical volunteer workflow:
1. Call ends → volunteer on call detail page
2. Auto-linked: "Known contact: [alias]" banner
3. Not linked: "Add caller as contact?" prompt
4. Volunteer creates contact (display name, risk level, tags)
5. Writes notes (already linked to call)
6. Mentions family/lawyer: adds support contacts
7. Transcript extraction suggests additional info

### Streamlined call detail page

- **Contact card** (top): linked contact or "Add Contact" prompt
- **Notes section**: note creation with contact auto-link
- **Transcript panel**: with extraction button
- **Support contacts**: quick-add from call context

---

## 5. API

```
POST /api/contacts/from-call/:callId    → create contact + auto-link in one step
POST /api/contacts/:id/support-contact  → create support contact + relationship in one step
```

### `POST /api/contacts/from-call/:callId`

1. Creates the contact (same body as `POST /api/contacts`)
2. Creates `contact_call_links` row
3. Auto-assigns to handler's teams (per Teams spec)
4. Returns created contact

Requires: `contacts:create`

### `POST /api/contacts/:id/support-contact`

1. Creates new contact for the support person
2. Creates encrypted relationship linking to parent contact
3. Returns both new contact and relationship

Body:
```typescript
{
  contact: CreateContactInput
  encryptedRelationshipPayload: string
  relationshipEnvelopes: RecipientEnvelope[]
}
```

Requires: `contacts:create`

---

## 6. React Query Integration

```typescript
// Mutations
export const useCreateContactFromCall = () => useMutation({
  mutationFn: ({ callId, data }) => createContactFromCall(callId, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    queryClient.invalidateQueries({ queryKey: queryKeys.calls.all })
  },
})

export const useCreateSupportContact = () => useMutation({
  mutationFn: ({ contactId, data }) => createSupportContact(contactId, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
    queryClient.invalidateQueries({ queryKey: queryKeys.contactRelationships.all })
  },
})
```

---

## 7. Testing

### Unit tests
- `extractContactEntities()`: phone patterns, email patterns, name+relationship patterns
- Confidence level assignment

### API tests
- `POST /api/contacts/from-call/:callId` creates contact + link
- `POST /api/contacts/:id/support-contact` creates contact + relationship
- Permission gating on both endpoints
- Team auto-assignment on contact creation from call

### UI E2E tests
- Call detail: "Add as Contact" creates contact and shows linked state
- Call detail: "Link to Existing" opens ContactSelect and creates link
- Call detail: "Unlink" removes link
- Transcript extraction: entities shown with actions
- Support contact quick-add from note

---

## 8. Non-Goals

- ML-based entity extraction — future (regex sufficient for phone/email/name)
- Automatic contact creation from transcript — always user-initiated
- Transcript search across contacts — future
- Voice-to-contact during live call — post-call only
