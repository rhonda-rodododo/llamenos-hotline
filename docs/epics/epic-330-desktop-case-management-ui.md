# Epic 330: Desktop: Case Management UI

**Status**: PENDING
**Priority**: High
**Depends on**: Epic 319 (Record Entity), Epic 321 (CMS RBAC), Epic 323 (Interactions)
**Blocks**: None
**Branch**: `desktop`

## Summary

Build the primary case management interface for the desktop app -- the main user-facing feature of the entire CMS. Includes a record list page with filtering by entity type, status, severity, assignee, and date range; schema-driven form rendering where fields are dynamically generated from `EntityTypeDefinition`; a record detail page with tabbed sections (Details, Timeline, Contacts, Evidence, Related); a create record wizard; status change with confirmation dialog; assignment management; and bulk operations (multi-select status change, bulk assign). This is the largest UI epic in the case management system. Routes: `/cases` (list), `/cases/:id` (detail), `/cases/new` (create). ~18 files created, ~8 files modified.

## Problem Statement

Epics 315-325 provide the backend infrastructure for case management: schema definitions, contacts, records, interactions, evidence. But the desktop app has no UI for any of it. Volunteers and admins need to:
- Browse and filter cases by type, status, severity, and assignment
- Create new cases using schema-driven forms that adapt to the entity type
- View case details with all custom fields, linked contacts, timeline, and evidence
- Change case status with confirmation
- Assign volunteers to cases
- Perform bulk operations during mass events (assign 20 cases to a coordinator, close all resolved cases)

This epic must handle the "SugarCRM flexibility" requirement: the UI renders forms dynamically from entity type definitions, not from compile-time components. A hub running jail support shows different fields than one running street medic or immigration rapid response, but the same UI code powers all of them.

## Implementation

### Phase 1: API Verification

No new API routes. This epic consumes APIs from:
- Epic 319: `GET/POST/PATCH/DELETE /api/records`, `/api/records/:id`, `/api/records/by-number/:number`, `/api/records/:id/contacts`, `/api/records/:id/assign`
- Epic 321: Permission checks via existing middleware
- Epic 323: `GET /api/records/:id/interactions`
- Epic 315: `GET /api/settings/entity-types` (for schema-driven rendering)

### Phase 2: Desktop UI

#### Task 1: Case List Route

**File**: `src/client/routes/cases.tsx` (new)

TanStack Router file route at `/cases`:

```typescript
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/cases')({
  component: CaseListPage,
  validateSearch: (search: Record<string, unknown>) => ({
    entityTypeId: (search.entityTypeId as string) || undefined,
    statusHash: (search.statusHash as string) || undefined,
    severityHash: (search.severityHash as string) || undefined,
    assignedTo: (search.assignedTo as string) || undefined,
    page: Number(search.page) || 1,
  }),
})
```

#### Task 2: Case List Page Component

**File**: `src/client/components/cases/CaseListPage.tsx` (new)

Main list view:

```typescript
interface CaseListPageProps {
  entityTypes: EntityTypeDefinition[]
  records: Record[]
  pagination: { page: number; total: number; hasMore: boolean }
  activeFilters: RecordFilters
}
```

Layout:
- **Header**: Page title ("Cases"), "New Case" button, bulk actions toolbar (visible when selection active)
- **Entity type tabs**: horizontal tab bar with each entity type's icon + name, plus "All" tab
- **Filter bar**: status dropdown, severity dropdown, assignee dropdown, date range picker
- **Record table**: DataTable with columns: checkbox (selection), case number, status badge, severity badge, title (decrypted from summary), assignee names, created date, updated date
- **Pagination**: page numbers + next/prev
- **Empty state**: "No cases found" with "Create a case" CTA

The entity type tabs filter records by `entityTypeId`. Selecting a tab updates URL search params and re-fetches.

Status and severity dropdowns are populated from the selected entity type's definition (`entityType.statuses`, `entityType.severities`). When the user selects a status, the client computes the blind index hash and adds `statusHash` to the query.

Key `data-testid` attributes:
- `case-list-page` -- page container
- `case-list-create-button` -- create new case button
- `case-list-entity-tab-{entityTypeId}` -- entity type filter tab
- `case-list-entity-tab-all` -- "All" tab
- `case-list-status-filter` -- status dropdown
- `case-list-severity-filter` -- severity dropdown
- `case-list-assignee-filter` -- assignee dropdown
- `case-list-table` -- data table
- `case-row-{recordId}` -- each record row
- `case-row-checkbox-{recordId}` -- selection checkbox
- `case-row-number-{recordId}` -- case number cell
- `case-row-status-{recordId}` -- status badge
- `case-row-severity-{recordId}` -- severity badge
- `case-list-pagination` -- pagination controls
- `case-list-empty` -- empty state
- `bulk-actions-bar` -- bulk actions toolbar
- `bulk-assign-button` -- bulk assign action
- `bulk-status-button` -- bulk status change action

#### Task 3: Schema-Driven Form Renderer

**File**: `src/client/components/cases/SchemaForm.tsx` (new)

The core reusable component that renders form fields from an `EntityTypeDefinition`:

```typescript
interface SchemaFormProps {
  entityType: EntityTypeDefinition
  values: Record<string, unknown>
  onChange: (fieldName: string, value: unknown) => void
  readOnly?: boolean
  showSections?: boolean        // Group fields by section headings
  accessLevel?: 'all' | 'assigned' | 'admin'  // Filter fields by access level
}
```

Field type rendering:
- `text` -> `<Input>` (shadcn/ui)
- `textarea` -> `<Textarea>` (shadcn/ui)
- `number` -> `<Input type="number">`
- `select` -> `<Select>` (shadcn/ui) with options from field definition
- `multiselect` -> custom multi-select with checkboxes
- `checkbox` -> `<Checkbox>` (shadcn/ui)
- `date` -> `<Input type="date">`

Conditional visibility (`showWhen`):
```typescript
function isFieldVisible(field: EntityFieldDefinition, values: Record<string, unknown>): boolean {
  if (!field.showWhen) return true
  const { field: condField, operator, value } = field.showWhen
  const currentValue = values[condField]
  switch (operator) {
    case 'equals': return currentValue === value
    case 'notEquals': return currentValue !== value
    case 'contains': return String(currentValue).includes(String(value))
    default: return true
  }
}
```

Section grouping:
- Fields with the same `section` value are grouped under a heading
- Sections are rendered in order of their first field's `order` value
- Fields without a section go in a "General" group

Key `data-testid` attributes:
- `schema-form` -- form container
- `schema-field-{fieldName}` -- each field wrapper
- `schema-field-input-{fieldName}` -- input element for each field
- `schema-section-{sectionName}` -- section heading

#### Task 4: Create Record Wizard

**File**: `src/client/components/cases/CreateRecordWizard.tsx` (new)

Multi-step dialog for creating a new record:

```typescript
interface CreateRecordWizardProps {
  entityTypes: EntityTypeDefinition[]
  preselectedType?: string       // If opened from entity type tab
  preselectedContact?: string    // If opened from contact profile
  open: boolean
  onCreated: (record: Record) => void
  onCancel: () => void
}
```

Steps:
1. **Select Entity Type** (skipped if preselected) -- grid of entity type cards
2. **Fill Fields** -- SchemaForm component with the selected entity type
3. **Link Contacts** (optional) -- search and link contacts with role selection
4. **Assign** (optional) -- select volunteer(s) to assign
5. **Review & Create** -- summary of what will be created

The wizard handles encryption:
1. Collect field values from the form
2. Group fields by access level (summary, fields, PII)
3. Encrypt each group with a random symmetric key
4. Wrap keys via ECIES for appropriate recipients
5. Compute blind index hashes for indexable fields
6. Submit to `POST /api/records`

Key `data-testid` attributes:
- `create-record-wizard` -- wizard dialog
- `create-wizard-step-{number}` -- step indicator
- `create-wizard-type-{entityTypeId}` -- entity type selection card
- `create-wizard-form` -- schema form area
- `create-wizard-contact-search` -- contact search input
- `create-wizard-contact-{contactId}` -- linked contact row
- `create-wizard-assignee-select` -- assignee selector
- `create-wizard-submit` -- create button
- `create-wizard-cancel` -- cancel button
- `create-wizard-next` -- next step
- `create-wizard-back` -- previous step

#### Task 5: Record Detail Route

**File**: `src/client/routes/cases_.$id.tsx` (new)

TanStack Router file route at `/cases/:id`:

```typescript
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/cases/$id')({
  component: RecordDetailPage,
})
```

#### Task 6: Record Detail Page Component

**File**: `src/client/components/cases/RecordDetailPage.tsx` (new)

Full detail view for a single record:

```typescript
interface RecordDetailPageProps {
  record: Record
  entityType: EntityTypeDefinition
  contacts: RecordContact[]
  interactions: CaseInteraction[]
}
```

Layout:
- **Header**: case number, entity type icon + name, status badge (clickable for status change), severity badge, created/updated dates
- **Action bar**: Edit button, Assign button, Link Contact button, Change Status button, more actions dropdown
- **Tabbed content**:
  1. **Details** -- SchemaForm in read-only mode (or edit mode when Edit clicked), grouped by sections
  2. **Timeline** -- CaseTimeline component (Epic 332, shows placeholder here)
  3. **Contacts** -- list of linked contacts with role badges, "Link Contact" button
  4. **Evidence** -- evidence file list (Epic 332, shows placeholder here)
  5. **Related** -- linked events, reports, and parent/child records

Key `data-testid` attributes:
- `record-detail-page` -- page container
- `record-case-number` -- case number display
- `record-status-badge` -- status badge (clickable)
- `record-severity-badge` -- severity badge
- `record-edit-button` -- edit mode toggle
- `record-assign-button` -- open assignment panel
- `record-change-status-button` -- open status change dialog
- `record-tab-details` -- Details tab
- `record-tab-timeline` -- Timeline tab
- `record-tab-contacts` -- Contacts tab
- `record-tab-evidence` -- Evidence tab
- `record-tab-related` -- Related tab
- `record-details-form` -- schema form in details tab
- `record-contact-list` -- contact list in contacts tab
- `record-contact-{contactId}` -- each linked contact
- `record-contact-role-{contactId}` -- contact role badge

#### Task 7: Status Change Dialog

**File**: `src/client/components/cases/StatusChangeDialog.tsx` (new)

Confirmation dialog for changing record status:

```typescript
interface StatusChangeDialogProps {
  record: Record
  entityType: EntityTypeDefinition
  currentStatus: string
  open: boolean
  onConfirm: (newStatus: string) => void
  onCancel: () => void
}
```

Shows:
- Current status with badge
- Dropdown of available statuses (from entity type definition)
- Arrow indicator: current -> new
- Warning if changing to a closed status
- Confirm / Cancel buttons

After confirmation, triggers notification dialog (Epic 327) if support contacts exist.

Key `data-testid` attributes:
- `status-change-dialog` -- dialog root
- `status-current` -- current status display
- `status-new-select` -- new status dropdown
- `status-change-confirm` -- confirm button
- `status-change-cancel` -- cancel button
- `status-closed-warning` -- warning for terminal status

#### Task 8: Assignment Panel

**File**: `src/client/components/cases/AssignmentPanel.tsx` (new)

Sheet/panel for managing record assignments:

```typescript
interface AssignmentPanelProps {
  record: Record
  assignedVolunteers: Array<{ pubkey: string; name: string }>
  availableVolunteers: Array<{ pubkey: string; name: string }>
  open: boolean
  onAssign: (pubkeys: string[]) => void
  onUnassign: (pubkey: string) => void
  onClose: () => void
}
```

Key `data-testid` attributes:
- `assignment-panel` -- panel container
- `assigned-volunteer-{pubkey}` -- each assigned volunteer
- `unassign-button-{pubkey}` -- unassign action
- `available-volunteer-{pubkey}` -- each available volunteer
- `assign-button-{pubkey}` -- assign action
- `assignment-search` -- volunteer search input

#### Task 9: Bulk Operations Toolbar

**File**: `src/client/components/cases/BulkActionsBar.tsx` (new)

Sticky toolbar shown when records are selected in the list:

```typescript
interface BulkActionsBarProps {
  selectedCount: number
  selectedIds: string[]
  entityType: EntityTypeDefinition
  onBulkStatusChange: (newStatus: string) => void
  onBulkAssign: (pubkeys: string[]) => void
  onClearSelection: () => void
}
```

Actions:
- "Change Status" -- opens status dropdown, applies to all selected records
- "Assign" -- opens volunteer selector, assigns to all selected records
- "Clear Selection" -- deselects all
- Selected count indicator

Key `data-testid` attributes:
- `bulk-actions-bar` -- toolbar container
- `bulk-selected-count` -- selection count
- `bulk-status-change` -- status change dropdown
- `bulk-assign` -- assign action
- `bulk-clear` -- clear selection

#### Task 10: Sidebar Navigation

**File**: `src/client/components/Sidebar.tsx` (modify)

Add case management section to the sidebar:

```typescript
// Dynamic navigation items from entity types:
entityTypes
  .filter(et => et.showInNavigation)
  .map(et => ({
    label: et.labelPlural,
    href: `/cases?entityTypeId=${et.id}`,
    icon: entityTypeIcon(et.icon),
    testId: `nav-cases-${et.name}`,
  }))
```

Shows entity type icons and names as sidebar links, filtered to types with `showInNavigation: true`. Also includes a top-level "Cases" link to `/cases` (all entity types).

#### Task 11: i18n Strings

**File**: `packages/i18n/locales/en.json` (modify)

```json
{
  "cases": {
    "title": "Cases",
    "allCases": "All Cases",
    "newCase": "New Case",
    "createCase": "Create Case",
    "editCase": "Edit Case",
    "caseNumber": "Case Number",
    "status": "Status",
    "severity": "Severity",
    "assignee": "Assignee",
    "assignedTo": "Assigned To",
    "unassigned": "Unassigned",
    "createdAt": "Created",
    "updatedAt": "Updated",
    "closedAt": "Closed",
    "details": "Details",
    "timeline": "Timeline",
    "contacts": "Contacts",
    "evidence": "Evidence",
    "related": "Related",
    "changeStatus": "Change Status",
    "statusChangeConfirm": "Change status from {{from}} to {{to}}?",
    "statusClosedWarning": "This is a closed status. The case will be marked as resolved.",
    "assignVolunteer": "Assign Volunteer",
    "unassignVolunteer": "Unassign",
    "linkContact": "Link Contact",
    "selectContactRole": "Select contact role",
    "selectEntityType": "Select case type",
    "fillFields": "Fill in details",
    "linkContacts": "Link contacts (optional)",
    "assignVolunteers": "Assign volunteers (optional)",
    "reviewAndCreate": "Review & Create",
    "noCases": "No cases found",
    "createFirstCase": "Create your first case to get started",
    "filterByStatus": "Filter by status",
    "filterBySeverity": "Filter by severity",
    "filterByAssignee": "Filter by assignee",
    "bulkActions": "Bulk Actions",
    "bulkChangeStatus": "Change Status ({{count}})",
    "bulkAssign": "Assign ({{count}})",
    "clearSelection": "Clear Selection",
    "selectedCount": "{{count}} selected"
  }
}
```

#### Task 12: BDD Feature File

**File**: `packages/test-specs/features/platform/desktop/cases/case-management.feature` (new)

```gherkin
@desktop
Feature: Case Management UI (Desktop)
  Volunteers and admins can browse, create, and manage cases
  using the schema-driven case management interface.

  Background:
    Given the user is logged in as an admin
    And case management is enabled
    And entity type "arrest_case" exists with statuses "reported", "confirmed", "released"

  @case-list
  Scenario: View case list page
    Given 5 arrest cases exist
    When the user navigates to "/cases"
    Then the case list should show 5 records
    And each record should display case number, status, and severity

  @case-list
  Scenario: Filter cases by entity type
    Given 3 arrest cases and 2 medical encounters exist
    When the user clicks the "Arrest Cases" entity tab
    Then only 3 records should be visible

  @case-list
  Scenario: Filter cases by status
    Given arrest cases with statuses "reported" and "confirmed"
    When the user selects "Reported" in the status filter
    Then only "reported" cases should be visible

  @case-create
  Scenario: Create a new case via wizard
    When the user clicks "New Case"
    And selects entity type "Arrest Case"
    And fills in required fields:
      | arrest_location  | Main St & 5th Ave |
      | arrest_time      | 2026-03-14 14:30  |
      | arresting_agency | NYPD              |
      | attorney_status  | Needs Attorney    |
      | release_status   | In Custody        |
    And clicks "Create"
    Then the case should be created with a case number
    And the user should be redirected to the case detail page

  @case-detail
  Scenario: View case detail page
    Given an arrest case "JS-2026-0001" exists
    When the user navigates to the case detail page
    Then the case number "JS-2026-0001" should be visible
    And the status badge should be visible
    And the "Details" tab should show schema-driven fields

  @case-status
  Scenario: Change case status with confirmation
    Given an arrest case with status "reported"
    When the user clicks the status badge
    And selects "Confirmed" from the status dropdown
    And confirms the status change
    Then the status badge should update to "Confirmed"

  @case-assign
  Scenario: Assign volunteer to case
    Given an arrest case and a registered volunteer "vol1"
    When the user clicks "Assign"
    And selects volunteer "vol1"
    Then "vol1" should appear in the assigned volunteers list

  @case-bulk
  Scenario: Bulk status change
    Given 3 arrest cases with status "reported"
    When the user selects all 3 cases
    And clicks "Change Status" in the bulk actions bar
    And selects "Confirmed"
    Then all 3 cases should have status "Confirmed"

  @case-contacts
  Scenario: Link contact to case
    Given an arrest case exists
    And contact "Carlos Martinez" exists
    When the user opens the "Contacts" tab
    And clicks "Link Contact"
    And searches for "Carlos Martinez"
    And selects role "Arrestee"
    And confirms
    Then "Carlos Martinez" should appear in the contact list with role "Arrestee"

  @case-conditional
  Scenario: Conditional field visibility
    Given an arrest case with attorney_status "Needs Attorney"
    When the user views the case details
    Then the "Attorney Name" field should be hidden
    When the user changes attorney_status to "Has Attorney"
    Then the "Attorney Name" field should become visible
```

## Files to Create

| File | Purpose |
|------|---------|
| `src/client/routes/cases.tsx` | Case list route |
| `src/client/routes/cases_.$id.tsx` | Case detail route |
| `src/client/components/cases/CaseListPage.tsx` | Record list with filters + table |
| `src/client/components/cases/SchemaForm.tsx` | Schema-driven form renderer |
| `src/client/components/cases/CreateRecordWizard.tsx` | Multi-step create wizard |
| `src/client/components/cases/RecordDetailPage.tsx` | Record detail with tabs |
| `src/client/components/cases/StatusChangeDialog.tsx` | Status change confirmation |
| `src/client/components/cases/AssignmentPanel.tsx` | Volunteer assignment panel |
| `src/client/components/cases/BulkActionsBar.tsx` | Bulk operations toolbar |
| `packages/test-specs/features/platform/desktop/cases/case-management.feature` | Desktop BDD scenarios |
| `tests/steps/cases/case-management-steps.ts` | Desktop step definitions |

## Files to Modify

| File | Change |
|------|--------|
| `src/client/components/Sidebar.tsx` | Add case management nav section |
| `src/client/routes/__root.tsx` | Register new routes (if not auto-discovered) |
| `src/client/lib/api.ts` | Add record API client functions |
| `packages/i18n/locales/en.json` | Add cases i18n section |
| `packages/i18n/locales/*.json` | Propagate to all 13 locales |
| `tests/test-ids.ts` | Add case management test IDs |
| `src/client/lib/platform.ts` | Add record encryption/decryption helpers |
| `src/client/lib/blind-index.ts` | Client-side blind index computation (if not already from Epic 316) |

## Testing

### Desktop BDD
- `bun run test:desktop` -- 10 scenarios in `case-management.feature`

## Acceptance Criteria & Test Scenarios

- [ ] Case list page displays records
  -> `packages/test-specs/features/platform/desktop/cases/case-management.feature: "View case list page"`
- [ ] Filtering by entity type works
  -> `packages/test-specs/features/platform/desktop/cases/case-management.feature: "Filter cases by entity type"`
- [ ] Filtering by status works
  -> `packages/test-specs/features/platform/desktop/cases/case-management.feature: "Filter cases by status"`
- [ ] Create record wizard works end-to-end
  -> `packages/test-specs/features/platform/desktop/cases/case-management.feature: "Create a new case via wizard"`
- [ ] Record detail page displays all fields
  -> `packages/test-specs/features/platform/desktop/cases/case-management.feature: "View case detail page"`
- [ ] Status change with confirmation works
  -> `packages/test-specs/features/platform/desktop/cases/case-management.feature: "Change case status with confirmation"`
- [ ] Volunteer assignment works
  -> `packages/test-specs/features/platform/desktop/cases/case-management.feature: "Assign volunteer to case"`
- [ ] Bulk status change works
  -> `packages/test-specs/features/platform/desktop/cases/case-management.feature: "Bulk status change"`
- [ ] Contact linking works
  -> `packages/test-specs/features/platform/desktop/cases/case-management.feature: "Link contact to case"`
- [ ] Conditional field visibility works
  -> `packages/test-specs/features/platform/desktop/cases/case-management.feature: "Conditional field visibility"`
- [ ] All platform BDD suites pass
- [ ] Backlog files updated

## Feature Files

| File | Status | Description |
|------|--------|-------------|
| `packages/test-specs/features/platform/desktop/cases/case-management.feature` | New | 10 desktop scenarios for case management UI |
| `tests/steps/cases/case-management-steps.ts` | New | Desktop step definitions |

## Risk Assessment

- **High risk**: Schema-driven form renderer (Task 3) -- this is the most architecturally important component. It must correctly handle all field types, conditional visibility, section grouping, and access level filtering. Edge cases: deeply nested showWhen conditions, fields with the same name across sections, empty option lists. Mitigated by exhaustive unit tests and Playwright snapshot testing.
- **High risk**: E2EE in create wizard (Task 4) -- the wizard must correctly group fields by access level, encrypt each tier, compute blind indexes, and determine envelope recipients. Any bug here results in data loss or security vulnerability. Mitigated by reusing the proven encryption patterns from NoteForm and testing with the Tauri IPC mock.
- **Medium risk**: Bulk operations (Task 9) -- changing status or assigning 20+ records in one action requires multiple API calls. Must handle partial failures gracefully (show which succeeded, which failed). Mitigated by sequential execution with per-record error handling.
- **Medium risk**: Performance with 1000+ records (Task 2) -- the list view must handle large result sets. Mitigated by server-side pagination (cursor-based via CaseDO) and client-side virtualization only if needed.
- **Low risk**: Routing (Tasks 1, 5) -- standard TanStack Router file-based routes.

## Execution

- **Phase 1**: Verify Epic 319, 321, 323 APIs (no new code)
- **Phase 2**: SchemaForm -> CaseListPage -> CreateRecordWizard -> RecordDetailPage -> StatusChangeDialog -> AssignmentPanel -> BulkActionsBar -> Sidebar nav -> Routes -> i18n -> API client -> BDD -> gate
- **Phase 3**: `bun run test:all`
