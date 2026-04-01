# Bulk Operations — Design Spec (Revised)

**Date:** 2026-03-30 (revised from 2026-03-28 original)
**Status:** Draft
**Scope:** Multi-select and bulk actions in the contact directory — tag/untag, risk level update, soft delete, message blast, and team assignment.
**Depends on:** Contact Directory v1 (2026-03-30), Tag Management (2026-03-30), Contact Profile Actions (2026-03-30), Teams & Assignment (2026-03-30)

---

## 1. Multi-Select in Contact Directory

### UI pattern

- Checkbox column on each contact row (appears on hover or when bulk mode active)
- "Select All" checkbox in header (selects all visible/filtered contacts)
- Bulk action toolbar (sticky at top when 1+ selected)
- Selection count badge: "12 selected"
- "Clear Selection" button

### Selection state

Client-side `Set<string>` of contact IDs. Not persisted — clears on page navigation or filter change.

### Toolbar actions

| Action | Icon | Permission Required |
|--------|------|-------------------|
| Tag | `Tag` | `contacts:update-own` or higher scope |
| Untag | `TagOff` | Same |
| Set Risk Level | `AlertTriangle` | Same |
| Assign to Team | `Users` | `contacts:update-assigned` or higher |
| Delete | `Trash2` | `contacts:delete` + appropriate scope |
| Send Message | `Send` | `contacts:envelope-full` + `conversations:send` |

---

## 2. Bulk Tag / Untag

1. Select contacts → click "Tag" in toolbar
2. Popover shows `TagInput` component (from Tag Management spec)
3. User picks tags to add
4. `PATCH /api/contacts/bulk` with `{ contactIds, addTags }`
5. Server appends tags to each contact's JSONB array (no duplicates)

Untag: same flow with `removeTags` instead.

Tags are plaintext — no envelope re-encryption needed.

---

## 3. Bulk Risk Level Update

1. Select contacts → click "Set Risk Level"
2. Popover with radio buttons (low/medium/high/critical)
3. `PATCH /api/contacts/bulk` with `{ contactIds, riskLevel }`

Risk level is plaintext — no envelope re-encryption needed.

---

## 4. Bulk Team Assignment

1. Select contacts → click "Assign to Team"
2. Team picker dropdown (hub-key decrypted team names)
3. `POST /api/teams/:id/contacts` with `{ contactIds }` (from Teams spec)
4. Returns `{ assigned, skipped }`

---

## 5. Bulk Soft Delete

1. Select contacts → click "Delete"
2. Confirm dialog: "Delete N contacts? This can be undone by an admin."
3. `DELETE /api/contacts/bulk` with `{ contactIds }`
4. Server sets `deletedAt` on each contact within user's scope

---

## 6. Bulk Message Blast

1. Select contacts → click "Send Message"
2. Dialog: message textarea (supports `{{displayName}}`), channel preference
3. Preview: N recipients grouped by channel type
4. Client decrypts each contact's channel info (requires `contacts:envelope-full`)
5. `POST /api/contacts/blast` with decrypted channel info
6. Server routes through messaging adapters
7. Toast with delivery summary

### Distinction from existing BlastService

Contact blast targets specific selected contacts (ad-hoc), not subscriber lists (campaign-based). Uses per-contact preferred channels, not subscription channels. No scheduling.

---

## 7. API

### `PATCH /api/contacts/bulk`

```typescript
{
  contactIds: string[]
  addTags?: string[]
  removeTags?: string[]
  riskLevel?: string
}
```

Returns: `{ updated: number, skipped: number }` (skipped = out of scope)

### `DELETE /api/contacts/bulk`

```typescript
{ contactIds: string[] }
```

Returns: `{ deleted: number, skipped: number }`

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

Returns: `{ sent: number, failed: number, errors: Array<{ contactId: string, error: string }> }`

---

## 8. Scope Enforcement

Each bulk endpoint verifies the user's scope against every contact ID:
1. Fetch all requested contacts
2. Filter to contacts within user's scope (`-own`, `-assigned`, `-all`)
3. Apply operation only to in-scope contacts
4. Return count of skipped contacts

This prevents scope escalation — a user with `contacts:update-own` can't bulk-tag contacts they don't own.

---

## 9. React Query

```typescript
export const useBulkUpdateContacts = () => useMutation({
  mutationFn: bulkUpdateContacts,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all }),
})

export const useBulkDeleteContacts = () => useMutation({
  mutationFn: bulkDeleteContacts,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all }),
})

export const useContactBlast = () => useMutation({
  mutationFn: sendContactBlast,
})
```

---

## 10. Testing

### API tests
- Bulk tag: adds tags without duplicates, returns updated/skipped counts
- Bulk untag: removes specified tags
- Bulk risk level: updates all in-scope contacts
- Bulk delete: soft-deletes in-scope, skips out-of-scope
- Scope enforcement: user with `update-own` can't bulk-edit others' contacts
- Blast: sends through messaging adapters, returns sent/failed counts

### UI E2E tests
- Multi-select: checkbox selection, select all, clear
- Bulk toolbar appears/disappears on selection
- Bulk tag: popover with TagInput, confirmation
- Bulk delete: confirm dialog, contacts removed from list
- Bulk team assignment: team picker, confirmation
- Scope: volunteer only sees bulk actions for own contacts

### Unit tests
- Scope filtering logic for bulk operations
- Contact blast recipient resolution with channel fallback

---

## 11. Non-Goals

- Bulk re-encryption of envelopes — too expensive, do per-contact
- Bulk assign to case manager — use team assignment instead
- Scheduled/recurring blasts — use existing BlastService
- Delivery status tracking per recipient — future
