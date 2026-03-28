> **Status: DRAFT — Needs Review.** Verify against codebase, check third-party docs, and review with user before writing implementation plan. May need revision after other specs land.

# Tag Management — Design Spec

**Goal:** Replace freeform string tags with a managed tag system — admin-defined vocabulary with colors, autocomplete, permission-gated freeform creation, and server-side GIN index filtering for scale.

**Depends on:** Spec 0 (User Identity & PBAC Redesign) for permission types.

---

## 1. Tag Definition Model

Tags become first-class entities with metadata, not just strings.

### `tags` table

```typescript
interface TagsTable {
  id: string
  hubId: string
  name: string                    // unique per hub, lowercase, no spaces (slug-like)
  label: string                   // human-readable display label (e.g., "Repeat Caller")
  color: string                   // hex color (e.g., "#ef4444")
  category: string | null         // optional grouping (e.g., "status", "type", "priority")
  createdBy: string               // pubkey of creator
  createdAt: Date
}
```

Tag `name` is the stored value (lowercase, slug-style: `repeat-caller`). Tag `label` is what users see (`Repeat Caller`). Tag `color` is displayed as badge background.

Unique constraint: `(hubId, name)` — no duplicate tag names within a hub.

### Encryption

Tag definitions are **hub-key encrypted** (org metadata tier, same as role names, hub names, custom field labels). The `label` and `category` fields are encrypted. The `name` field stays plaintext for server-side filtering (it's a slug, not PII). The `color` stays plaintext.

```typescript
interface TagsTableEncrypted {
  id: string
  hubId: string
  name: string                              // plaintext slug for filtering
  encryptedLabel: Ciphertext                // hub-key encrypted
  color: string                             // plaintext
  encryptedCategory: Ciphertext | null      // hub-key encrypted
  createdBy: string
  createdAt: Date
}
```

---

## 2. Permissions

### New permission

```typescript
'tags:create': {
  label: 'Create new tags',
  group: 'tags',
  subgroup: 'actions',
}
```

### Tag access model

| Action | Permission Required |
|--------|-------------------|
| View/use existing tags (autocomplete) | Any contact permission (contacts:read-own or higher) |
| Create new freeform tags | `tags:create` |
| Edit tag definitions (label, color, category) | `settings:manage-fields` (existing) |
| Delete tags | `settings:manage-fields` |

### Hub setting

```typescript
strictTags: boolean  // default: true
```

When `strictTags` is true: only admin-defined tags can be used, regardless of `tags:create` permission. When false: users with `tags:create` can type new tags that get auto-created.

### Default role assignments

- **Hub Admin:** `tags:create` (via `contacts:*` or explicit)
- **Case Manager:** `tags:create`
- **Volunteer:** no `tags:create` — picks from the list only
- **Reporter:** no `tags:create`

---

## 3. Contact Tag Storage

Currently, contacts store tags as `tags: string[]` (JSONB array of freeform strings). This changes to store **tag IDs** referencing the `tags` table:

```typescript
// Old
tags: jsonb<string[]>()('tags').notNull().default([])

// New — tag names (slugs) for server-side filtering
tags: jsonb<string[]>()('tags').notNull().default([])
```

Actually — keep storing tag **names** (slugs), not IDs. This is simpler, avoids joins, and the slug is already the unique key per hub. The `tags` table provides metadata (label, color) that the client looks up after fetching contacts.

### GIN index for server-side tag filtering

```sql
CREATE INDEX contacts_tags_gin_idx ON contacts USING GIN (tags);
```

This enables efficient server-side queries:

```sql
-- Contacts with a specific tag
SELECT * FROM contacts WHERE tags @> '["detained"]'::jsonb AND hub_id = $1;

-- Contacts with any of several tags
SELECT * FROM contacts WHERE tags ?| ARRAY['detained', 'legal-aid'] AND hub_id = $1;
```

The `listContacts` service method adds tag filtering as a proper DB query instead of in-memory filtering.

---

## 4. API

```
GET    /api/tags                  → list all tags for hub
POST   /api/tags                  → create tag (tags:create or settings:manage-fields)
PATCH  /api/tags/:id              → update tag metadata (settings:manage-fields)
DELETE /api/tags/:id              → delete tag (settings:manage-fields)
```

### Freeform tag auto-creation

When a user with `tags:create` permission applies a tag that doesn't exist in the hub's tag definitions:

1. Client sends the contact update with the new tag name
2. Server checks if tag exists in `tags` table for this hub
3. If not, and user has `tags:create`, auto-creates the tag with a default color and no category
4. If not, and user lacks `tags:create`, rejects the tag (400 error)
5. If `strictTags` is true, rejects regardless of permission

---

## 5. Frontend

### Tag autocomplete component

New `TagInput` component replaces the current comma-separated text input:

- Searchable dropdown of defined tags for the hub
- Each tag shown with its color dot and label
- Multi-select with removable badge chips (colored)
- If user has `tags:create` and hub allows freeform: "Create [typed text]" option at bottom of dropdown
- If no `tags:create` or `strictTags`: dropdown only, no freeform

### Tag admin section

In the admin settings, under the existing custom fields section (or as a sibling section):

- Table of defined tags: label, color dot, category, usage count
- Create tag: label input, color picker, optional category
- Edit inline: label, color, category
- Delete with confirmation (warns if tag is in use on N contacts)

### Contact directory table

Tag badges in the contact list show the tag's color as background tint, not the current neutral gray. The `Badge` component accepts a `style` prop for dynamic color.

### Contact profile

Same colored tag badges in the summary section.

---

## 6. Default Tags

When a hub is created, seed it with a sensible default tag set (admins can delete/modify):

| Name | Label | Color | Category |
|------|-------|-------|----------|
| `repeat-caller` | Repeat Caller | `#3b82f6` (blue) | status |
| `detained` | Detained | `#ef4444` (red) | status |
| `released` | Released | `#22c55e` (green) | status |
| `legal-aid` | Legal Aid | `#8b5cf6` (purple) | type |
| `shelter-contact` | Shelter Contact | `#f59e0b` (amber) | type |
| `family-member` | Family Member | `#06b6d4` (cyan) | type |
| `urgent` | Urgent | `#dc2626` (red) | priority |
| `follow-up` | Follow Up | `#f97316` (orange) | priority |
| `resolved` | Resolved | `#16a34a` (green) | priority |

---

## 7. Non-Goals

- Tag hierarchy/nesting (future)
- Tag-based automation rules (future)
- Cross-hub tag sharing
- Tag merge/rename with bulk update (future — for now, editing a tag label doesn't rename it on existing contacts since contacts store the slug)
