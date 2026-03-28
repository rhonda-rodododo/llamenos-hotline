> **Status: DRAFT — Needs Review.** Verify against codebase, check third-party docs, and review with user before writing implementation plan. May need revision after other specs land.

# Post-Call Data Entry — Design Spec

**Goal:** Provide a permission-scoped structured form for users to contribute contact information after a call without seeing existing PII — enabling volunteers to capture what they learned during a call while a triaging role (case manager) structures it into the contact record.

**Depends on:** Spec 0 (PBAC Redesign), Contact Directory v1 (PR #26), Call-to-Contact Workflow (Spec 3).

---

## 1. Problem

During a call, a volunteer learns things: the caller's name, their sister's phone number, that they're detained at facility X, that they need a lawyer. The volunteer should capture this immediately after the call.

But the volunteer may not have `contacts:envelope-full` — they can't see or edit the contact's full record. And even if they could, we don't want them overwriting structured data entered by a case manager.

**Solution:** An "intake" form that creates an encrypted submission linked to the call and contact. A case manager (or other triaging role) reviews intake submissions and merges relevant info into the contact record.

---

## 2. Intake Model

### `contact_intakes` table

```typescript
interface ContactIntakesTable {
  id: string
  hubId: string
  contactId: string | null         // linked contact (if known)
  callId: string | null            // linked call (if from a call)

  // Encrypted intake payload (E2EE envelope)
  encryptedPayload: Ciphertext     // IntakePayload JSON
  payloadEnvelopes: RecipientEnvelope[]  // submitter + case managers + admins

  status: string                   // 'pending' | 'reviewed' | 'merged' | 'dismissed'
  reviewedBy: string | null        // pubkey of reviewer
  reviewedAt: Date | null

  submittedBy: string              // pubkey of submitter
  createdAt: Date
}
```

### Intake payload (encrypted)

```typescript
interface IntakePayload {
  // Freeform text (what the volunteer heard/learned)
  notes: string

  // Structured fields (optional — volunteer fills what they can)
  callerName?: string
  callerPhone?: string
  callerRelationship?: string      // "I'm his sister", "I'm calling for my client"

  // Support contacts mentioned
  supportContacts?: Array<{
    name: string
    phone?: string
    relationship: string           // "sister", "lawyer", "case worker"
    isEmergency: boolean
  }>

  // Location/situation
  facility?: string                // "ICE processing center on Main St"
  situation?: string               // "detained", "released", "in court"
  urgency: 'low' | 'medium' | 'high' | 'critical'

  // Custom fields (hub-configured)
  customFields?: Record<string, unknown>
}
```

---

## 3. Permissions

| Action | Permission |
|--------|-----------|
| Submit intake | `contacts:create` (any user who can create contacts can submit intake) |
| View own intakes | `contacts:read-own` |
| View all pending intakes | `contacts:read-all` + triage permission |
| Review/merge/dismiss intake | `contacts:update-assigned` or `contacts:update-all` |

### New permission

```typescript
'contacts:triage': {
  label: 'Review and merge intake submissions into contact records',
  group: 'contacts',
  subgroup: 'actions',
}
```

Default assignment: Case Manager, Hub Admin.

---

## 4. Workflow

### Volunteer submits intake

1. Call ends → volunteer sees "Add Contact Info" prompt on call detail page
2. Opens the intake form (NOT the full create contact dialog)
3. Volunteer fills in what they know: freeform notes, name, phone, support contacts
4. Client encrypts the intake payload with envelopes for: submitter + all users with `contacts:triage` permission
5. `POST /api/contacts/intakes` — linked to the call and contact (if auto-linked)
6. Toast: "Information submitted for review"

### Case manager triages intake

1. Case manager sees intake queue: `/contacts/intakes` (list of pending intakes)
2. Opens an intake → sees the decrypted freeform notes and structured fields
3. Actions:
   - **Merge** → opens the linked contact record side-by-side, case manager copies/edits relevant fields into the contact, marks intake as merged
   - **Create Contact** → if no linked contact exists, creates one from the intake data
   - **Dismiss** → marks intake as irrelevant/duplicate
4. Merged intakes stay in the system as audit trail (status: 'merged', linked to contact)

### Key UX: volunteer never sees the full contact record

The intake form is intentionally simpler than the contact edit form. The volunteer contributes information; the case manager curates it. This:
- Protects PII (volunteer doesn't see existing legal name, phone, etc.)
- Prevents accidental overwrites
- Creates a review checkpoint for data quality
- Matches the real-world workflow (rapid response volunteer captures info, case manager structures it later)

---

## 5. API

```
POST   /api/contacts/intakes              → submit intake
GET    /api/contacts/intakes              → list intakes (filtered by status, scoped by permission)
GET    /api/contacts/intakes/:id          → single intake
PATCH  /api/contacts/intakes/:id          → update status (review/merge/dismiss)
GET    /api/contacts/:id/intakes          → intakes linked to a specific contact
```

---

## 6. Frontend

### Intake form (volunteer-facing)

Accessible from:
- Call detail page: "Add Contact Info" button
- Contact profile page: "Submit Info" button (if user lacks edit permission)

Fields:
- Freeform notes (textarea, required)
- Caller name (text, optional)
- Caller phone (PhoneInput, optional)
- Support contacts (repeatable group: name, phone, relationship, emergency checkbox)
- Situation (select: detained/released/in court/other)
- Urgency (radio: low/medium/high/critical)
- Hub-configured custom fields (filtered to intake context)

### Intake queue (case manager-facing)

Route: `/contacts/intakes`

- Table of pending intakes: submitter, linked contact, linked call, urgency badge, timestamp
- Click → intake detail with side-by-side contact view
- Merge/dismiss actions
- Filter by status (pending/reviewed/merged/dismissed)
- Sort by urgency, then timestamp

### Intake badge on contact profile

The contact profile shows a badge: "3 pending intakes" — visible to users with `contacts:triage`.

---

## 7. Non-Goals

- Automatic merge (always human-reviewed)
- Intake templates per hub (future — for now, fixed field set + custom fields)
- Intake assignment to specific triagers (future — for now, any user with `contacts:triage` can review)
- Intake expiration/auto-dismiss (future)
