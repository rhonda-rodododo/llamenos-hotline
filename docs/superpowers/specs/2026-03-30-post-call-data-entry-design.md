# Post-Call Data Entry — Design Spec (Revised)

**Date:** 2026-03-30 (revised from 2026-03-28 original)
**Status:** Draft
**Scope:** Permission-scoped intake forms for volunteers to contribute contact info after calls without seeing existing PII. Case managers triage intake into structured contact records.
**Depends on:** Contact Directory v1 (2026-03-30), PBAC Scope Hierarchy (2026-03-30), Call-to-Contact Workflow (2026-03-30)

---

## 1. Problem

During a call, a volunteer learns things: the caller's name, their sister's phone number, that they're detained at facility X. The volunteer should capture this immediately.

But the volunteer may not have `contacts:envelope-full` — they can't see or edit the contact's full record. Even if they could, we don't want them overwriting structured data entered by a case manager.

**Solution:** An intake form that creates an encrypted submission linked to the call and contact. A case manager reviews and merges relevant info into the contact record.

---

## 2. Data Model

### `contact_intakes` table

```typescript
interface ContactIntakesTable {
  id: string
  hubId: string
  contactId: string | null         // linked contact (if known)
  callId: string | null            // linked call (if from a call)

  encryptedPayload: Ciphertext     // IntakePayload JSON
  payloadEnvelopes: RecipientEnvelope[]  // submitter + users with contacts:triage

  status: string                   // 'pending' | 'reviewed' | 'merged' | 'dismissed'
  reviewedBy: string | null
  reviewedAt: Date | null

  submittedBy: string
  createdAt: Date
}
```

### Intake payload (encrypted)

```typescript
interface IntakePayload {
  notes: string                             // freeform (what the volunteer heard)
  callerName?: string
  callerPhone?: string
  callerRelationship?: string               // "I'm his sister"
  supportContacts?: Array<{
    name: string
    phone?: string
    relationship: string
    isEmergency: boolean
  }>
  facility?: string
  situation?: string                        // "detained", "released", "in court"
  urgency: 'low' | 'medium' | 'high' | 'critical'
  customFields?: Record<string, unknown>    // hub-configured fields
}
```

### Crypto label

```typescript
export const LABEL_CONTACT_INTAKE = 'llamenos:contact-intake:v1'
```

Add to `src/shared/crypto-labels.ts`.

---

## 3. Permissions

### New permission

```typescript
'contacts:triage': {
  label: 'Review and merge intake submissions into contact records',
  group: 'contacts',
  subgroup: 'actions',
}
```

### Access model

| Action | Permission Required |
|--------|-------------------|
| Submit intake | `contacts:create` |
| View own intakes | `contacts:read-own` |
| View all pending intakes | `contacts:triage` |
| Review/merge/dismiss intake | `contacts:triage` + `contacts:update-assigned` or higher |

### Default assignments

- **Case Manager**: `contacts:triage`
- **Hub Admin**: `contacts:triage` (via `contacts:*`)
- **Volunteer**: no triage — submit only

### Envelope recipients

When a volunteer submits an intake:
- Submitter's pubkey (they can view their own submissions)
- All pubkeys with `contacts:triage` permission in the hub

---

## 4. Workflow

### Volunteer submits intake

1. Call ends → "Add Contact Info" prompt on call detail page
2. Opens intake form (simpler than full create contact dialog)
3. Volunteer fills what they know: freeform notes, name, phone, support contacts
4. Client encrypts with envelopes for submitter + triage users
5. `POST /api/contacts/intakes`
6. Toast: "Information submitted for review"

### Case manager triages

1. Intake queue at `/contacts/intakes`
2. Opens intake → decrypted fields shown
3. Actions:
   - **Merge** → side-by-side with linked contact, copy fields, mark as merged
   - **Create Contact** → if no linked contact, create from intake data
   - **Dismiss** → mark as irrelevant/duplicate
4. Merged intakes kept for audit trail

### Key UX: volunteer never sees full contact record

The intake form is intentionally simpler. Volunteer contributes; case manager curates. This:
- Protects PII
- Prevents accidental overwrites
- Creates a review checkpoint
- Matches real-world workflow (rapid response volunteer captures, case manager structures later)

---

## 5. API

```
POST   /api/contacts/intakes              → submit intake
GET    /api/contacts/intakes              → list intakes (filtered by status, scoped)
GET    /api/contacts/intakes/:id          → single intake
PATCH  /api/contacts/intakes/:id          → update status (review/merge/dismiss)
GET    /api/contacts/:id/intakes          → intakes linked to a specific contact
```

---

## 6. Frontend

### Intake form (volunteer-facing)

Accessible from:
- Call detail page: "Add Contact Info" button
- Contact profile: "Submit Info" button (if user lacks edit permission)

Fields:
- Freeform notes (textarea, required)
- Caller name (text, optional)
- Caller phone (`PhoneInput`, optional)
- Support contacts (repeatable group: name, phone, relationship, emergency)
- Situation (select: detained/released/in court/other)
- Urgency (radio: low/medium/high/critical)
- Hub-configured custom fields (filtered to intake context)

### Intake queue (case manager-facing)

Route: `/contacts/intakes`

- Table: submitter, linked contact, linked call, urgency badge, timestamp
- Click → intake detail with side-by-side contact view
- Merge/dismiss actions
- Filter by status (pending/reviewed/merged/dismissed)
- Sort by urgency, then timestamp

### Contact profile badge

"N pending intakes" badge visible to users with `contacts:triage`.

### React Query

```typescript
queryKeys.intakes = {
  all: ['intakes'] as const,
  list: (filters?: IntakeFilters) => ['intakes', 'list', filters] as const,
  detail: (id: string) => ['intakes', 'detail', id] as const,
  forContact: (contactId: string) => ['intakes', 'contact', contactId] as const,
}
```

---

## 7. Testing

### Unit tests
- Envelope recipient resolution (submitter + triage users)
- Status transitions (pending → reviewed → merged/dismissed)

### API tests
- Submit intake: creates with encrypted payload
- List intakes: filtered by status and scoped by permission
- Merge intake: updates status, audit trail preserved
- Permission gating: triage requires `contacts:triage`
- Intake linked to contact and call correctly

### UI E2E tests
- Volunteer submits intake from call detail page
- Case manager sees intake in queue
- Merge workflow: side-by-side comparison, field copy
- Dismiss workflow
- Pending intake badge on contact profile
- Volunteer cannot access triage queue

---

## 8. Non-Goals

- Automatic merge — always human-reviewed
- Intake templates per hub — future (fixed field set + custom fields for now)
- Intake assignment to specific triagers — future
- Intake expiration/auto-dismiss — future
