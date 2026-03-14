# Epic 331: Desktop: Contact Directory & Relationship Graph

**Status**: PENDING
**Priority**: High
**Depends on**: Epic 318 (Contact Entity), Epic 322 (Relationships & Networks)
**Blocks**: None
**Branch**: `desktop`

## Summary

Build the desktop contact directory UI -- a searchable, filterable list of contacts with profile pages, identifier management, relationship visualization, affinity group management, and a contact merge tool for deduplication. The contact directory is the people-centered counterpart to the case management UI (Epic 330). Routes: `/contacts` (list), `/contacts/:id` (profile). Contacts are E2EE with 2-tier encryption (summary visible to all volunteers, PII visible only to authorized roles). Search is powered by trigram blind indexes for privacy-preserving name lookup. The merge tool allows admins to combine duplicate contacts, merging identifiers, relationships, and case links. ~14 files created, ~5 files modified.

## Problem Statement

Epic 318 provides the backend for contact storage (ContactDirectoryDO) and Epic 322 adds relationships and affinity groups. But the desktop app has no UI to:
- Browse and search contacts
- View a contact's full profile (decrypted from summary + PII tiers)
- See all identifiers (phone numbers, Signal usernames, emails) for a contact
- View and manage relationships between contacts
- Create and manage affinity groups (named groups of contacts)
- Merge duplicate contacts that represent the same person
- See a contact's case history (all cases they are linked to)

The contact directory must handle the 2-tier encryption model: volunteers see the summary tier (display name, contact type, tags) while admins additionally see the PII tier (legal name, phone numbers, demographics). The UI must gracefully degrade when the user does not have PII access.

## Implementation

### Phase 1: API Verification

No new API routes. This epic consumes APIs from:
- Epic 318: `GET /api/directory` (list), `GET /api/directory/:id` (single), `POST /api/directory` (create), `PATCH /api/directory/:id` (update), `DELETE /api/directory/:id` (delete), `GET /api/directory/lookup/:identifierHash`, `GET /api/directory/search?tokens=` (trigram search)
- Epic 322: `GET/POST/DELETE /api/contacts/:id/relationships`, `GET/POST/PATCH/DELETE /api/contacts/groups`
- Epic 319: `GET /api/records/by-contact/:contactId` (case history)

### Phase 2: Desktop UI

#### Task 1: Contact List Route

**File**: `src/client/routes/contacts-directory.tsx` (new)

TanStack Router file route at `/contacts`:

```typescript
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/contacts-directory')({
  component: ContactDirectoryPage,
  validateSearch: (search: Record<string, unknown>) => ({
    contactTypeHash: (search.contactTypeHash as string) || undefined,
    tagHash: (search.tagHash as string) || undefined,
    page: Number(search.page) || 1,
  }),
})
```

Note: Uses `/contacts-directory` as the route path since `/contacts` may already exist for the legacy contact aggregation view. Alternative: replace the existing `/contacts` route entirely, since Epic 318 supersedes the legacy contact system.

#### Task 2: Contact List Page

**File**: `src/client/components/contacts/ContactListPage.tsx` (new)

Main contact directory view:

```typescript
interface ContactListPageProps {
  contacts: Contact[]
  pagination: { page: number; total: number; hasMore: boolean }
}
```

Layout:
- **Header**: "Contact Directory" title, "New Contact" button
- **Search bar**: text input for name search (computes trigram tokens, queries via blind index)
- **Filter bar**: contact type dropdown, tag filter chips
- **Contact list**: card layout (not table -- contacts are people, cards feel more appropriate)
  - Each card shows: avatar placeholder (initials), display name, contact type badge, tag badges, case count, last interaction date
  - Click card -> navigate to profile page
- **Pagination**: page controls at bottom

Search flow:
1. User types in search bar (debounced 300ms)
2. Client normalizes input: lowercase, strip diacritics
3. Client generates trigram tokens from search string
4. Client computes blind index hash for each trigram
5. Sends tokens to `GET /api/directory/search?tokens=hash1,hash2,hash3`
6. Server returns matching contacts

Key `data-testid` attributes:
- `contact-list-page` -- page container
- `contact-search-input` -- search text input
- `contact-type-filter` -- contact type dropdown
- `contact-tag-filter` -- tag filter
- `contact-create-button` -- create new contact button
- `contact-card-{contactId}` -- each contact card
- `contact-card-name-{contactId}` -- display name
- `contact-card-type-{contactId}` -- contact type badge
- `contact-card-cases-{contactId}` -- case count
- `contact-list-empty` -- empty state
- `contact-list-pagination` -- pagination

#### Task 3: Contact Profile Page

**File**: `src/client/routes/contacts-directory_.$id.tsx` (new)

Route for `/contacts/:id`:

```typescript
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/contacts-directory/$id')({
  component: ContactProfilePage,
})
```

#### Task 4: Contact Profile Component

**File**: `src/client/components/contacts/ContactProfilePage.tsx` (new)

Full profile view for a single contact:

```typescript
interface ContactProfilePageProps {
  contact: Contact
  decryptedSummary: ContactSummary
  decryptedPII: ContactPII | null   // null if user lacks PII access
}
```

Layout:
- **Header**: avatar (initials), display name, contact type badge, edit/delete actions
- **Tabbed content**:
  1. **Profile** -- decrypted profile information
  2. **Identifiers** -- list of phone numbers, Signal usernames, emails
  3. **Relationships** -- related contacts with relationship type and direction
  4. **Groups** -- affinity groups this contact belongs to
  5. **Cases** -- list of linked cases with role

**Profile tab**:
- Summary tier (visible to all): display name, contact type, tags, status
- PII tier (visible to authorized users): legal name, aliases, demographics (pronouns, language, age), emergency contacts, communication preferences
- If PII is not accessible, show a locked indicator: "You do not have permission to view personal details"

**Identifiers tab**:
- List of identifiers with type icon (Phone, Signal, Email, Nickname)
- Each identifier shows: type, value (decrypted from PII), isPrimary badge
- "Add Identifier" button (admin only)

**Relationships tab**:
- List of related contacts with relationship type label and direction arrow
- Each row: contact name (linked), relationship type, direction (e.g., "is attorney for" or "has attorney")
- "Add Relationship" button

**Groups tab**:
- List of affinity groups with member count
- Each group: name, description, role in group, isPrimary badge
- "Create Group" and "Add to Group" buttons

**Cases tab**:
- List of all cases linked to this contact
- Each row: case number, entity type icon, status badge, role in case, date linked
- Click row -> navigate to case detail page

Key `data-testid` attributes:
- `contact-profile-page` -- page container
- `contact-profile-name` -- display name header
- `contact-profile-type` -- contact type badge
- `contact-profile-edit` -- edit button
- `contact-profile-delete` -- delete button
- `contact-tab-profile` -- Profile tab
- `contact-tab-identifiers` -- Identifiers tab
- `contact-tab-relationships` -- Relationships tab
- `contact-tab-groups` -- Groups tab
- `contact-tab-cases` -- Cases tab
- `contact-pii-locked` -- PII access denied indicator
- `contact-identifier-{index}` -- each identifier row
- `contact-identifier-type-{index}` -- identifier type icon
- `contact-relationship-{contactId}` -- each relationship row
- `contact-group-{groupId}` -- each affinity group
- `contact-case-{recordId}` -- each linked case

#### Task 5: Contact Create/Edit Form

**File**: `src/client/components/contacts/ContactForm.tsx` (new)

Form for creating or editing a contact:

```typescript
interface ContactFormProps {
  contact: Contact | null         // null = create mode
  open: boolean
  onSave: (data: CreateContactBody) => void
  onCancel: () => void
}
```

Fields:
- Display name (required)
- Contact type (dropdown: caller, support_contact, attorney, volunteer, other)
- Tags (chip input)
- Identifiers (repeatable group: type + value + isPrimary)
- Legal name
- Aliases (repeatable text input)
- Demographics: pronouns, language (dropdown from LANGUAGES), age, race, gender, nationality
- Emergency contacts (repeatable group: name, relationship, phone, signal)
- Communication preferences: preferred channel, preferred language, do not contact toggle
- Notes (textarea)

The form handles encryption on save:
1. Split fields into summary tier (displayName, contactType, tags, status) and PII tier (everything else)
2. Encrypt each tier with a random symmetric key
3. Wrap keys via ECIES for appropriate recipients
4. Compute identifier hashes and trigram tokens
5. Submit to `POST /api/directory` or `PATCH /api/directory/:id`

Key `data-testid` attributes:
- `contact-form` -- form root
- `contact-form-display-name` -- display name input
- `contact-form-type` -- contact type dropdown
- `contact-form-tags` -- tag input
- `contact-form-identifier-{index}` -- each identifier group
- `contact-form-add-identifier` -- add identifier button
- `contact-form-legal-name` -- legal name input
- `contact-form-save` -- save button
- `contact-form-cancel` -- cancel button

#### Task 6: Contact Merge Tool

**File**: `src/client/components/contacts/ContactMergeTool.tsx` (new)

Dialog for merging two duplicate contacts:

```typescript
interface ContactMergeToolProps {
  sourceContact: Contact
  targetContact: Contact
  open: boolean
  onMerge: () => void
  onCancel: () => void
}
```

UI flow:
1. Select two contacts (from contact list via multi-select or from profile page "Merge with...")
2. Preview shows side-by-side comparison:
   - Display names
   - Identifiers (union of both)
   - Relationships (union of both)
   - Case links (union of both)
   - Interaction counts (summed)
3. Select which contact is the "primary" (keeps the ID)
4. "Merge" button merges the secondary into the primary:
   - All identifiers from secondary added to primary
   - All relationships from secondary moved to primary
   - All case links from secondary moved to primary
   - Interaction counts summed
   - Secondary contact is deleted
5. Server-side: re-index all identifier hashes, update all reverse indexes

Requires `contacts:merge` permission.

Key `data-testid` attributes:
- `contact-merge-tool` -- dialog root
- `merge-source-name` -- source contact name
- `merge-target-name` -- target contact name
- `merge-preview-identifiers` -- identifier union preview
- `merge-preview-cases` -- case link union preview
- `merge-primary-select` -- primary contact selector
- `merge-confirm` -- merge button
- `merge-cancel` -- cancel button

#### Task 7: Affinity Group Components

**File**: `src/client/components/contacts/AffinityGroupList.tsx` (new)
**File**: `src/client/components/contacts/AffinityGroupDetail.tsx` (new)

Affinity group management:

```typescript
// AffinityGroupList
interface AffinityGroupListProps {
  groups: AffinityGroup[]
  onSelect: (groupId: string) => void
  onCreate: () => void
}

// AffinityGroupDetail
interface AffinityGroupDetailProps {
  group: AffinityGroup
  members: AffinityGroupMember[]
  onAddMember: (contactId: string, role?: string) => void
  onRemoveMember: (contactId: string) => void
  onEdit: () => void
  onDelete: () => void
}
```

Key `data-testid` attributes:
- `group-list` -- group list container
- `group-card-{groupId}` -- each group card
- `group-create-button` -- create group button
- `group-detail-{groupId}` -- group detail view
- `group-member-{contactId}` -- each member in detail
- `group-add-member` -- add member button
- `group-remove-member-{contactId}` -- remove member

#### Task 8: Sidebar Navigation

**File**: `src/client/components/Sidebar.tsx` (modify)

Add contact directory to sidebar navigation:

```typescript
{
  label: t('contacts.directory'),
  href: '/contacts-directory',
  icon: Users,
  permission: 'contacts:view',
  testId: 'nav-contact-directory',
}
```

#### Task 9: i18n Strings

**File**: `packages/i18n/locales/en.json` (modify)

```json
{
  "contactDirectory": {
    "title": "Contact Directory",
    "search": "Search contacts...",
    "newContact": "New Contact",
    "editContact": "Edit Contact",
    "deleteContact": "Delete Contact",
    "profile": "Profile",
    "identifiers": "Identifiers",
    "relationships": "Relationships",
    "groups": "Groups",
    "casesLinked": "Cases",
    "piiLocked": "You do not have permission to view personal details",
    "noContacts": "No contacts in the directory",
    "addFirstContact": "Add your first contact or they'll be created automatically from calls",
    "contactType": "Contact Type",
    "tags": "Tags",
    "lastInteraction": "Last interaction",
    "caseCount": "{{count}} case(s)",
    "mergeContacts": "Merge Contacts",
    "mergePreview": "Preview merge results",
    "mergePrimary": "Keep as primary",
    "mergeConfirm": "Merge into primary contact",
    "mergeWarning": "This will combine all identifiers, relationships, and case links. The secondary contact will be deleted.",
    "affinityGroups": "Affinity Groups",
    "createGroup": "Create Group",
    "groupName": "Group Name",
    "groupDescription": "Description",
    "groupMembers": "Members",
    "addMember": "Add Member",
    "removeMember": "Remove",
    "groupRole": "Role in group",
    "primaryContact": "Primary Contact",
    "addIdentifier": "Add Contact Method",
    "identifierType": "Type",
    "identifierValue": "Value",
    "addRelationship": "Add Relationship",
    "relationshipType": "Relationship",
    "relatedContact": "Related Contact",
    "communicationPreferences": "Communication Preferences",
    "preferredChannel": "Preferred Channel",
    "doNotContact": "Do Not Contact"
  }
}
```

#### Task 10: BDD Feature File

**File**: `packages/test-specs/features/platform/desktop/cases/contact-directory.feature` (new)

```gherkin
@desktop
Feature: Contact Directory & Relationships (Desktop)
  Users can browse, search, and manage contacts.
  Admins can view PII, manage relationships, and merge duplicates.

  Background:
    Given the user is logged in as an admin
    And case management is enabled

  @contacts
  Scenario: View contact list
    Given 5 contacts exist in the directory
    When the user navigates to "/contacts-directory"
    Then 5 contact cards should be visible
    And each card should display the contact's display name

  @contacts
  Scenario: Search contacts by name
    Given contacts "Carlos Martinez", "Maria Garcia", "Carmen Lopez"
    When the user types "car" in the search box
    Then "Carlos Martinez" and "Carmen Lopez" should be visible
    And "Maria Garcia" should not be visible

  @contacts
  Scenario: View contact profile
    Given contact "Carlos Martinez" exists
    When the user clicks on "Carlos Martinez"
    Then the contact profile page should show "Carlos Martinez"
    And the "Profile" tab should be active
    And the display name should be visible

  @contacts
  Scenario: View identifiers on profile
    Given contact "Carlos Martinez" with phone and Signal identifiers
    When the user views the "Identifiers" tab
    Then the phone identifier should be visible
    And the Signal identifier should be visible

  @contacts @pii
  Scenario: PII hidden for unauthorized users
    Given the user is logged in as a volunteer without "contacts:view-pii"
    And contact "Carlos Martinez" exists
    When the user views the contact profile
    Then the PII locked indicator should be visible
    And the legal name should not be visible

  @contacts @relationships
  Scenario: View contact relationships
    Given contact "Carlos Martinez" has relationship "attorney" with "Sarah Lee"
    When the user views the "Relationships" tab on Carlos's profile
    Then "Sarah Lee" should be listed as "Attorney"

  @contacts @groups
  Scenario: Create affinity group
    Given contacts "Alice", "Bob", "Carol" exist
    When the user creates an affinity group "Pine Street Collective"
    And adds "Alice", "Bob", "Carol" as members
    Then the group should appear in the groups list
    And the member count should be 3

  @contacts @merge
  Scenario: Merge duplicate contacts
    Given contacts "Carlos M." and "Carlos Martinez" exist
    When the admin opens the merge tool for both contacts
    And selects "Carlos Martinez" as primary
    And confirms the merge
    Then only "Carlos Martinez" should exist
    And "Carlos Martinez" should have all identifiers from both contacts
```

## Files to Create

| File | Purpose |
|------|---------|
| `src/client/routes/contacts-directory.tsx` | Contact list route |
| `src/client/routes/contacts-directory_.$id.tsx` | Contact profile route |
| `src/client/components/contacts/ContactListPage.tsx` | Contact list with search + filters |
| `src/client/components/contacts/ContactProfilePage.tsx` | Contact profile with tabs |
| `src/client/components/contacts/ContactForm.tsx` | Create/edit contact form |
| `src/client/components/contacts/ContactMergeTool.tsx` | Duplicate merge tool |
| `src/client/components/contacts/AffinityGroupList.tsx` | Affinity group list |
| `src/client/components/contacts/AffinityGroupDetail.tsx` | Affinity group detail view |
| `packages/test-specs/features/platform/desktop/cases/contact-directory.feature` | Desktop BDD scenarios |
| `tests/steps/cases/contact-directory-steps.ts` | Desktop step definitions |

## Files to Modify

| File | Change |
|------|--------|
| `src/client/components/Sidebar.tsx` | Add contact directory nav link |
| `src/client/lib/api.ts` | Add contact directory API client functions |
| `src/client/lib/platform.ts` | Add contact encryption/decryption helpers |
| `packages/i18n/locales/en.json` | Add contactDirectory i18n section |
| `packages/i18n/locales/*.json` | Propagate to all 13 locales |
| `tests/test-ids.ts` | Add contact directory test IDs |

## Testing

### Desktop BDD
- `bun run test:desktop` -- 8 scenarios in `contact-directory.feature`

## Acceptance Criteria & Test Scenarios

- [ ] Contact list page displays contacts
  -> `packages/test-specs/features/platform/desktop/cases/contact-directory.feature: "View contact list"`
- [ ] Contact search by name works via trigram blind indexes
  -> `packages/test-specs/features/platform/desktop/cases/contact-directory.feature: "Search contacts by name"`
- [ ] Contact profile page shows decrypted summary
  -> `packages/test-specs/features/platform/desktop/cases/contact-directory.feature: "View contact profile"`
- [ ] Identifiers displayed on profile
  -> `packages/test-specs/features/platform/desktop/cases/contact-directory.feature: "View identifiers on profile"`
- [ ] PII hidden for unauthorized users
  -> `packages/test-specs/features/platform/desktop/cases/contact-directory.feature: "PII hidden for unauthorized users"`
- [ ] Relationships displayed
  -> `packages/test-specs/features/platform/desktop/cases/contact-directory.feature: "View contact relationships"`
- [ ] Affinity groups can be created
  -> `packages/test-specs/features/platform/desktop/cases/contact-directory.feature: "Create affinity group"`
- [ ] Contact merge works
  -> `packages/test-specs/features/platform/desktop/cases/contact-directory.feature: "Merge duplicate contacts"`
- [ ] All platform BDD suites pass
- [ ] Backlog files updated

## Feature Files

| File | Status | Description |
|------|--------|-------------|
| `packages/test-specs/features/platform/desktop/cases/contact-directory.feature` | New | 8 desktop scenarios for contact directory |
| `tests/steps/cases/contact-directory-steps.ts` | New | Desktop step definitions |

## Risk Assessment

- **Medium risk**: Trigram search UX (Task 2) -- trigram-based blind index search has inherent limitations: searches shorter than 3 characters return no results, and the search is not full-text (it is AND-intersection of trigram matches). The UX must communicate this clearly (e.g., "Enter at least 3 characters to search"). Mitigated by showing this as placeholder text and handling edge cases gracefully.
- **Medium risk**: 2-tier encryption display (Task 4) -- the profile page must handle the case where the user can decrypt the summary but not the PII. This requires careful conditional rendering and a clear "locked" indicator. Mitigated by testing with both admin and volunteer roles.
- **Medium risk**: Contact merge (Task 6) -- merging contacts is a destructive operation that touches multiple storage keys (identifiers, relationships, case links, indexes). Must be transactional (all-or-nothing). Mitigated by implementing server-side merge in ContactDirectoryDO with atomic storage operations.
- **Low risk**: Affinity groups (Task 7) -- straightforward CRUD UI with standard shadcn/ui components.
- **Low risk**: Route naming conflict (Task 1) -- existing `/contacts` route may conflict. Resolution: use `/contacts-directory` or replace the legacy route entirely.

## Execution

- **Phase 1**: Verify Epic 318 + 322 APIs (no new code)
- **Phase 2**: ContactListPage -> ContactProfilePage -> ContactForm -> ContactMergeTool -> AffinityGroupList -> AffinityGroupDetail -> Routes -> Sidebar nav -> i18n -> BDD -> gate
- **Phase 3**: `bun run test:all`
