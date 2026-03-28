> **Status: DRAFT — Needs Review.** Verify against codebase, check third-party docs, and review with user before writing implementation plan. May need revision after other specs land.

# Contact Profile Actions — Design Spec

**Goal:** Add actionable capabilities to the contact profile page — message support contacts via their preferred channel, add reports from contact view, and fix the relationship permission asymmetry.

**Depends on:** Spec 0 (PBAC Redesign), Contact Directory v1 (PR #26).

---

## 1. Contact Channels

Each contact can have multiple reachable channels stored in the encrypted PII blob (Tier 2).

### Data model

```typescript
interface ContactChannel {
  type: 'sms' | 'whatsapp' | 'signal' | 'telegram' | 'email'
  identifier: string    // phone number, Signal username, Telegram handle, email address
  preferred: boolean    // primary channel for this contact
  label: string         // optional: "Personal", "Work", "Lawyer's office"
}
```

Stored in the `encryptedPII` blob alongside existing PII fields:

```typescript
interface ContactPIIBlob {
  emailAddresses: string[]       // deprecated — migrate to channels
  address: string
  dateOfBirth: string
  identifiers: { label: string; value: string }[]
  channels: ContactChannel[]     // NEW — replaces emailAddresses + phoneNumbers
}
```

The per-field `encryptedPhone` column on the contacts table remains for the primary phone number (drives `identifierHash` for auto-linking). `channels` in the PII blob provides the full set of reachable endpoints.

### Channel resolution

When sending a message to a contact:
1. Find the contact's `preferred: true` channel
2. Check if the hub has that channel type configured (e.g., Signal adapter active)
3. If not, fall back to next available channel in order: Signal → WhatsApp → SMS → email
4. If no configured channel matches any of the contact's channels, show error

---

## 2. Notify Support Contacts

### Button on contact profile

The contact profile's Support Contacts section gets a "Notify" action per support contact, and a "Notify All Emergency" bulk action.

### Permission model

| Action | Permission |
|--------|-----------|
| See "Notify" button | `contacts:envelope-full` (must be able to decrypt channel info) |
| Send notification | `contacts:envelope-full` + relevant messaging permission (e.g., `conversations:send`) |
| "Notify All Emergency" | Same, but only shows contacts where `isEmergency: true` in the decrypted relationship |

### Volunteer emergency-only flow

A volunteer with `contacts:envelope-summary` (no full access) sees:
- Support contacts they added (they encrypted the relationship, so they can decrypt it)
- An "Alert Emergency Contacts" button that sends a pre-configured template message to emergency support contacts they can see
- They do NOT see non-emergency support contacts added by others

### Message sending

Uses the existing `MessagingAdapter` infrastructure:
1. Client decrypts the support contact's channel info
2. Client sends to server: `POST /api/contacts/:id/notify` with `{ targetContactIds: string[], message: string }`
3. Server looks up each target contact's preferred channel (server can't decrypt — client must send the channel info)
4. Actually: client sends `{ notifications: [{ contactId, channel: { type, identifier }, message }] }` — the decrypted channel info, since server can't access it
5. Server routes through the appropriate messaging adapter

### E2EE consideration

The notification message content and the recipient's channel identifier are briefly visible to the server during send (same as any outbound message). This is inherent to the messaging architecture — the telephony/messaging provider sees the recipient. The *stored record* of the notification is encrypted.

---

## 3. Add Report from Contact View

### Button on contact profile

"Add Report" button in the profile header or actions area. Opens the existing `ReportForm` sheet, pre-populated with a `contact` custom field referencing this contact.

### Implementation

1. Contact profile page adds an "Add Report" button
2. Clicking opens `ReportForm` with `defaultValues: { contactId: contact.id }`
3. The report's custom fields include a `contact` type field (from Spec v1, Task 11) that's pre-filled
4. On submit, the report is linked to the contact via the custom field value

No new backend work — uses existing report creation + contact custom field type.

---

## 4. Relationship Permission Fix

### Current asymmetry

- `POST /contacts/relationships` requires `contacts:create`
- `GET /contacts/relationships` requires `contacts:read-pii` (now `contacts:envelope-full`)

A user with `contacts:create` but not `contacts:envelope-full` can create relationships they can never read.

### Fix

Change `POST /contacts/relationships` to require `contacts:envelope-full`. Creating a relationship means you're encoding contact IDs and relationship details into the encrypted payload — you should be able to read relationships to do this meaningfully.

Exception: the volunteer emergency-only flow. A volunteer can add an emergency support contact they just learned about during a call (they have the info in the moment). This creates a relationship envelope that only users with `contacts:envelope-full` can read — including the volunteer if they encrypted for themselves.

So the fix is: `POST /contacts/relationships` requires `contacts:create` AND the client must include the creator's pubkey in the envelope recipients. The server doesn't gate on `contacts:envelope-full` — instead, the cryptographic enforcement ensures only envelope recipients can read it. The creator always includes themselves.

### Updated permission check

```typescript
// POST /contacts/relationships
contacts.post('/relationships', requirePermission('contacts:create'), async (c) => {
  // No additional permission check — cryptographic enforcement via envelopes
  // The client encrypts the payload for recipients it chooses
  // If the client doesn't include the creator, that's the client's problem
})
```

This is actually the current behavior — the "asymmetry" is intentional. The real fix is documentation, not code: add a comment explaining that relationship access is cryptographically enforced, not permission-enforced.

---

## 5. Frontend Changes

### Contact profile page updates

- **Channels section** in the PII card: list of channels with type icon, identifier (decrypted), preferred badge
- **"Notify" button** per support contact (if user has `contacts:envelope-full`)
- **"Alert Emergency Contacts"** bulk button (visible to users who can see emergency contacts)
- **"Add Report"** button in the profile header

### Notify dialog

When clicking "Notify" or "Alert Emergency Contacts":
1. Dialog opens with message textarea (pre-filled with configurable template)
2. Shows recipient list with channel type icons
3. "Send" button routes through messaging adapter
4. Toast confirmation on success

---

## 6. Non-Goals

- Two-way messaging threads with contacts (future — contacts are notified, they call back through the hotline)
- Notification templates admin UI (future — for now, freeform message text)
- Delivery status tracking for contact notifications (future — reuse message delivery status from conversations)
- Contact self-service portal (out of scope — contacts interact via phone/messaging only)
