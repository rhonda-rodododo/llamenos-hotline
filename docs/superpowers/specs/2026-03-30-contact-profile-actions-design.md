# Contact Profile Actions — Design Spec (Revised)

**Date:** 2026-03-30 (revised from 2026-03-28 original)
**Status:** Draft
**Scope:** Actionable capabilities on the contact profile page — multi-channel messaging to support contacts, "Add Report" from contact view, and relationship creation workflow.
**Depends on:** Contact Directory v1 (2026-03-30), PBAC Scope Hierarchy (2026-03-30)

---

## 1. Contact Channels

Each contact can have multiple reachable channels stored in the encrypted PII blob (Tier 2).

### Data model

```typescript
interface ContactChannel {
  type: 'sms' | 'whatsapp' | 'signal' | 'telegram' | 'email'
  identifier: string
  preferred: boolean
  label: string         // optional: "Personal", "Work"
}
```

Stored in the `encryptedPII` blob alongside existing PII fields:

```typescript
interface ContactPIIBlob {
  emailAddresses: string[]       // deprecated — migrate to channels
  address: string
  dateOfBirth: string
  identifiers: { label: string; value: string }[]
  channels: ContactChannel[]     // replaces emailAddresses + phoneNumbers
}
```

The per-field `encryptedPhone` column remains for the primary phone number (drives `identifierHash`). `channels` provides the full set of reachable endpoints.

### Channel resolution

When sending a message to a contact:
1. Find the contact's `preferred: true` channel
2. Check if the hub has that channel type configured (adapter active)
3. If not, fall back in order: Signal → WhatsApp → SMS → email
4. If no configured channel matches, show error

---

## 2. Notify Support Contacts

### Permission model

| Action | Permission Required |
|--------|-------------------|
| See "Notify" button | `contacts:envelope-full` (must decrypt channel info) |
| Send notification | `contacts:envelope-full` + `conversations:send` |
| "Notify All Emergency" | Same, restricted to `isEmergency: true` relationships |

### Volunteer emergency-only flow

A volunteer with `contacts:envelope-summary` (no full access) sees:
- Support contacts they added (they encrypted the relationship)
- An "Alert Emergency Contacts" button sending a pre-configured template message
- They do NOT see non-emergency support contacts added by others

### Message sending flow

1. Client decrypts support contact's channel info
2. Client sends to server: `POST /api/contacts/:id/notify`
3. Body: `{ notifications: [{ contactId, channel: { type, identifier }, message }] }`
4. Server routes through appropriate `MessagingAdapter`
5. The stored notification record is encrypted

### E2EE consideration

The notification message and recipient identifier are briefly visible to the server during send (same as any outbound message — inherent to messaging). The stored record of the notification is encrypted.

---

## 3. Add Report from Contact View

"Add Report" button in the contact profile header. Opens the existing `ReportForm` sheet pre-populated with a `contact` custom field referencing this contact.

Implementation:
1. Contact profile adds "Add Report" button (requires `reports:create`)
2. Opens `ReportForm` with `defaultValues: { contactId: contact.id }`
3. Report linked to contact via custom field value
4. No new backend — uses existing report creation + contact custom field type

---

## 4. Relationship Permission Clarification

Creating a relationship (`POST /contacts/relationships`) requires `contacts:create`. Access is cryptographically enforced — only envelope recipients can decrypt the relationship payload. The creator always includes themselves in the recipients. This is documented behavior, not a bug.

---

## 5. Frontend

### Contact profile page additions

- **Channels section** in PII card: list of channels with type icon, identifier, preferred badge
- **"Notify" button** per support contact (gated by `contacts:envelope-full`)
- **"Alert Emergency Contacts"** bulk button
- **"Add Report" button** in profile header (gated by `reports:create`)
- **"Add Support Contact" button** in relationships section → mini-form for quick creation

### Notify dialog

1. Message textarea (pre-filled with configurable template)
2. Recipient list with channel type icons
3. "Send" button routes through messaging adapter
4. Toast confirmation on success

### React Query

```typescript
// Mutation
export const useNotifyContacts = () => useMutation({
  mutationFn: (data: { contactId: string; notifications: NotifyPayload[] }) =>
    notifyContacts(data.contactId, data.notifications),
})
```

---

## 6. Testing

### API tests
- Notify endpoint sends through messaging adapter
- Permission gating: `contacts:envelope-full` required
- Channel resolution fallback logic

### UI E2E tests
- "Notify" button visible/hidden based on permissions
- "Alert Emergency Contacts" sends to emergency contacts only
- "Add Report" opens report form pre-populated
- "Add Support Contact" creates contact + relationship

### Unit tests
- Channel resolution: preferred channel, fallback order, no-match error
- Emergency contact filtering

---

## 7. Non-Goals

- Two-way messaging threads with contacts — future
- Notification templates admin UI — future (freeform text for now)
- Delivery status tracking — future (reuse conversation delivery status)
- Contact self-service portal
