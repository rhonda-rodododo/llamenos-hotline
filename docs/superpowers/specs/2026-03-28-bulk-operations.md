# Bulk Operations — Design Spec

**Goal:** Add multi-select and bulk actions to the contact directory — bulk tag/untag, bulk risk level update, bulk soft delete, and bulk message blast to selected contacts via their preferred channels.

**Depends on:** Spec 0 (PBAC Redesign), Spec 1 (Tag Management), Contact Directory v1 (PR #26), Contact Profile Actions (Spec 2 — for channel model).

---

## 1. Multi-Select in Contact Directory

### UI Pattern

- Checkbox column on the left of each contact row (appears on hover or when bulk mode is active)
- "Select All" checkbox in the header (selects all visible/filtered contacts)
- Bulk action toolbar appears when 1+ contacts selected (sticky at top of table)
- Selection count badge: "12 selected"
- "Clear Selection" button

### Selection state

Client-side `Set<string>` of contact IDs. Not persisted — clears on page navigation or filter change.

### Toolbar actions (shown when contacts selected)

| Action | Icon | Permission Required |
|--------|------|-------------------|
| Tag | `Tag` | `contacts:update-own` or higher (scoped to contacts user can edit) |
| Untag | `TagOff` | Same |
| Set Risk Level | `AlertTriangle` | Same |
| Delete | `Trash2` | `contacts:delete` |
| Send Message | `Send` | `contacts:envelope-full` + messaging permission |

---

## 2. Bulk Tag / Untag

### Flow

1. Select contacts → click "Tag" in toolbar
2. Popover shows tag autocomplete (reuses `TagInput` from Spec 1)
3. User picks one or more tags to add
4. Client sends: `PATCH /api/contacts/bulk` with `{ contactIds: string[], addTags: string[] }`
5. Server adds tags to each contact's `tags` array (JSONB append, no duplicates)

Untag: same flow but `removeTags: string[]` instead.

### E2EE consideration

Tags are plaintext (not encrypted) — bulk tag operations don't require envelope re-encryption. This is a server-side JSONB array update.

---

## 3. Bulk Risk Level Update

### Flow

1. Select contacts → click "Set Risk Level"
2. Popover shows risk level radio buttons (low/medium/high/critical)
3. User picks one
4. Client sends: `PATCH /api/contacts/bulk` with `{ contactIds: string[], riskLevel: string }`

Risk level is also plaintext — no envelope re-encryption needed.

---

## 4. Bulk Soft Delete

### Flow

1. Select contacts → click "Delete"
2. Confirm dialog: "Delete N contacts? This can be undone by an admin."
3. Client sends: `DELETE /api/contacts/bulk` with `{ contactIds: string[] }`
4. Server sets `deletedAt` on each contact

### Permission check

Server verifies the requesting user has `contacts:delete` permission AND scope to access each contact (`:own`, `:assigned`, or `:all`).

---

## 5. Bulk Message Blast

### Flow

1. Select contacts → click "Send Message"
2. Dialog opens:
   - Message textarea (supports template variables: `{{displayName}}`)
   - Channel preference: "Use each contact's preferred channel" (default) or force a specific channel
   - Preview: shows N recipients grouped by channel type
3. User confirms → client decrypts each contact's channel info (requires `contacts:envelope-full`)
4. Client sends: `POST /api/contacts/blast` with:
   ```typescript
   {
     recipients: Array<{
       contactId: string
       channel: { type: string, identifier: string }
     }>
     message: string
   }
   ```
5. Server routes each message through the appropriate messaging adapter
6. Toast with delivery summary

### E2EE flow

The client must decrypt each contact's channel info before sending. This means:
- Bulk blast only works for users with `contacts:envelope-full` (they have Tier 2 envelopes)
- The client decrypts channels in memory, builds the recipient list, sends to server
- Server sees channel identifiers briefly during send (same as any outbound message)
- Delivery records are encrypted

### Relationship to existing blasts

This is distinct from the existing `BlastService` (subscriber-based mass messaging). Contact blast:
- Targets specific selected contacts, not subscriber lists
- Uses per-contact preferred channels, not subscription channels
- Is ad-hoc (no scheduling, no templates), not campaign-based
- Does not create subscription relationships

Future: merge the two systems or allow contacts to opt into blast subscriber lists.

---

## 6. Bulk API Endpoints

```
PATCH  /api/contacts/bulk          → bulk update (tags, risk level)
DELETE /api/contacts/bulk          → bulk soft delete
POST   /api/contacts/blast         → bulk message blast
```

### `PATCH /api/contacts/bulk`

```typescript
{
  contactIds: string[]
  addTags?: string[]
  removeTags?: string[]
  riskLevel?: string
}
```

Server applies updates to all specified contacts within the user's access scope. Returns `{ updated: number, skipped: number }` (skipped = contacts outside user's scope).

### `DELETE /api/contacts/bulk`

```typescript
{
  contactIds: string[]
}
```

Server soft-deletes all specified contacts within scope. Returns `{ deleted: number, skipped: number }`.

### `POST /api/contacts/blast`

```typescript
{
  recipients: Array<{
    contactId: string
    channel: { type: string; identifier: string }
  }>
  message: string
}
```

Server sends message to each recipient via their specified channel. Returns `{ sent: number, failed: number, errors: Array<{ contactId: string, error: string }> }`.

---

## 7. Scope Enforcement on Bulk Operations

Each bulk endpoint must verify the user's scope permission against every contact ID:

1. Fetch all requested contacts
2. Filter to contacts within the user's scope (`:own`, `:assigned`, `:all`)
3. Apply the operation only to in-scope contacts
4. Return count of skipped contacts (out of scope) so the client can inform the user

This prevents scope escalation — a user with `contacts:update-own` can't bulk-tag contacts they don't own by guessing IDs.

---

## 8. Non-Goals

- Bulk re-encryption of envelopes (adding/removing recipients) — too expensive for bulk, do per-contact
- Bulk assign contacts to a case manager — future
- Bulk export selected contacts — covered in Spec 6 (Import/Export)
- Scheduled/recurring blasts to contacts — use the existing BlastService subscriber model
- Delivery status tracking per recipient — future (reuse conversation delivery status)
