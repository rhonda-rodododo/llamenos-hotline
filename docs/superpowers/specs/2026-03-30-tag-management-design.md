# Tag Management — Design Spec (Revised)

**Date:** 2026-03-30 (revised from 2026-03-28 original)
**Status:** Draft
**Scope:** Replace freeform string tags with a managed tag system — admin-defined vocabulary with colors, categories, autocomplete, permission-gated freeform creation, hub-key encrypted metadata, and server-side GIN index filtering.
**Depends on:** Volunteer → User rename (2026-03-29), PBAC Scope Hierarchy (2026-03-30), Contact Directory v1 (2026-03-30)

---

## Current State

Tags exist as freeform `tags: string[]` (JSONB) on the `contacts` table. No `tags` table, no tag definitions, no colors or categories. The contact directory UI shows tags as neutral gray badges. The create contact dialog accepts comma-separated freeform text.

---

## 1. Tag Definition Model

Tags become first-class entities with metadata, not just strings.

### `tags` table

```typescript
interface TagsTable {
  id: string
  hubId: string
  name: string                              // unique per hub, lowercase slug (e.g., "repeat-caller")
  encryptedLabel: Ciphertext                // hub-key encrypted display label (e.g., "Repeat Caller")
  color: string                             // hex color (e.g., "#ef4444") — plaintext
  encryptedCategory: Ciphertext | null      // hub-key encrypted grouping (e.g., "status", "type")
  createdBy: string                         // pubkey
  createdAt: Date
}
```

Unique constraint: `(hubId, name)`.

### Encryption rationale

- **`name`** (plaintext slug): used for server-side filtering via GIN index on `contacts.tags`. Slugs like `repeat-caller` or `detained` are operational labels — they reveal tag vocabulary but not who has the tag. This is acceptable given that `contactType` and `riskLevel` are also plaintext for the same reason.
- **`encryptedLabel`** (hub-key E2EE): the human-readable display label could reveal org-specific terminology (e.g., "ICE Detainee" vs generic "Detained"). Hub-key encrypted.
- **`color`** (plaintext): hex color has no informational value.
- **`encryptedCategory`** (hub-key E2EE): category names like "legal status" or "response type" reveal what the org tracks.

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

Add to `PERMISSION_CATALOG` in `src/shared/permissions.ts`.

### Tag access model

| Action | Permission Required |
|--------|-------------------|
| View/use existing tags (autocomplete) | Any contact read permission (`contacts:read-own` or higher) |
| Create new freeform tags | `tags:create` |
| Edit tag definitions (label, color, category) | `settings:manage-fields` |
| Delete tags | `settings:manage-fields` |

### Hub setting

```typescript
strictTags: boolean  // default: true
```

When `strictTags` is true: only admin-defined tags can be used, regardless of `tags:create` permission. When false: users with `tags:create` can type new tags that auto-create with default color and no category.

### Default role assignments

- **Hub Admin**: `tags:create` (via `contacts:*` or explicit)
- **Case Manager**: `tags:create`
- **Volunteer**: no `tags:create` — picks from the list only
- **Reporter**: no tag permissions

---

## 3. Contact Tag Storage

Tags on contacts continue to store **tag names** (slugs) as `string[]` JSONB, not IDs. This avoids joins for filtering and the slug is already the unique key per hub. The `tags` table provides metadata (label, color, category) that the client looks up after fetching.

### GIN index for server-side tag filtering

```sql
CREATE INDEX contacts_tags_gin_idx ON contacts USING GIN (tags);
```

Enables efficient queries:

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
POST   /api/tags                  → create tag
PATCH  /api/tags/:id              → update tag metadata
DELETE /api/tags/:id              → delete tag
```

### Freeform tag auto-creation

When a user applies a tag that doesn't exist in the hub's tag definitions:

1. Client sends the contact update with the new tag name
2. Server checks if tag exists in `tags` table for this hub
3. If not, and user has `tags:create`, and `strictTags` is false: auto-creates the tag with default color and no category
4. If not, and user lacks `tags:create`: rejects the tag (400 error)
5. If `strictTags` is true: rejects regardless of permission

### Response shape

```typescript
{
  id: string
  hubId: string
  name: string                    // plaintext slug
  encryptedLabel: Ciphertext      // hub-key encrypted
  color: string                   // hex
  encryptedCategory: Ciphertext | null
  createdBy: string
  createdAt: string
}
```

Client decrypts label and category with hub key.

---

## 5. React Query Integration

```typescript
// Query keys
queryKeys.tags = {
  all: ['tags'] as const,
  list: (hubId: string) => ['tags', 'list', hubId] as const,
}

// Options
export const tagsListOptions = (hubId: string) => queryOptions({
  queryKey: queryKeys.tags.list(hubId),
  queryFn: () => listTags(),
})

// Hooks
export const useTags = () => {
  const hubId = useCurrentHubId()
  return useQuery(tagsListOptions(hubId))
}

// Mutations
export const useCreateTag = () => useMutation({
  mutationFn: createTag,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags.all }),
})

export const useUpdateTag = () => useMutation({
  mutationFn: ({ id, data }) => updateTag(id, data),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags.all }),
})

export const useDeleteTag = () => useMutation({
  mutationFn: deleteTag,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags.all }),
})
```

---

## 6. Frontend

### `TagInput` component (new)

Replaces the current comma-separated text input for tags on contacts:

- Searchable dropdown of defined tags for the hub
- Each tag shown with its color dot and decrypted label
- Multi-select with removable badge chips (colored)
- If user has `tags:create` and hub allows freeform: "Create [typed text]" option at bottom of dropdown
- If no `tags:create` or `strictTags`: dropdown only, no freeform
- Uses shadcn `Command` + `Popover` pattern (same as `ContactSelect`)

### Tag admin section

In admin settings, under or alongside the custom fields section:

- Table of defined tags: decrypted label, color dot, decrypted category, usage count (number of contacts with this tag)
- Create tag: label input, color picker, optional category
- Edit inline: label, color, category
- Delete with confirmation (warns if tag is in use on N contacts)
- `strictTags` toggle setting

### Contact directory table

Tag badges show the tag's color as background tint instead of neutral gray. The `Badge` component accepts a `style` prop for dynamic `backgroundColor` and `color`.

### Contact profile

Same colored tag badges in the summary section. Inline tag editing uses `TagInput`.

### Contact directory filter

Add tag multi-select filter to the directory filter bar:
- Uses `TagInput` in filter mode (no create option)
- Server-side filtering via GIN index
- Combines with existing type and risk level filters

---

## 7. Default Tags

When a hub is created, seed with default tag definitions:

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

Labels and categories are hub-key encrypted on creation. Names and colors are plaintext.

---

## 8. Testing

### Unit tests

- Tag CRUD service methods
- GIN index tag filtering queries
- `strictTags` enforcement logic
- Freeform auto-creation with/without `tags:create` permission
- Hub-key encryption/decryption of label and category

### API tests

- `GET /api/tags` returns encrypted labels
- `POST /api/tags` requires `tags:create` or `settings:manage-fields`
- `PATCH /api/tags/:id` requires `settings:manage-fields`
- `DELETE /api/tags/:id` requires `settings:manage-fields`
- Freeform tag rejection when `strictTags` is true
- Freeform tag rejection when user lacks `tags:create`
- Tag filter on `GET /api/contacts` works with GIN index

### UI E2E tests

- Tag autocomplete shows defined tags with colors
- Freeform tag creation appears/hidden based on permission
- Tag admin: create, edit, delete tags
- Tag filter on contact directory
- Colored tag badges in directory and profile
- `strictTags` toggle disables freeform

---

## 9. Non-Goals

- Tag hierarchy/nesting — future
- Tag-based automation rules — future
- Cross-hub tag sharing
- Tag merge/rename with bulk update (editing a tag label doesn't rename the slug on existing contacts)
- Tag analytics / usage dashboards
