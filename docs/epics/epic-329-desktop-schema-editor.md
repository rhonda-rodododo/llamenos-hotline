# Epic 329: Desktop: Schema Editor & Template Browser

**Status**: PENDING
**Priority**: High
**Depends on**: Epic 315 (Entity Schema Engine), Epic 317 (Template System)
**Blocks**: None
**Branch**: `desktop`

## Summary

Build the admin-facing UI for managing entity type definitions, field configurations, enum editors, relationship types, and template browsing/application. This is the primary configuration interface for case management -- admins use it to define what entity types exist in their hub, what fields those entities have, how they relate to each other, and to apply pre-built templates. The schema editor lives in a new `/settings/case-management` route (a new tab in admin settings). Includes a visual field editor with drag-and-drop reorder, enum editors for statuses/severities/categories, a relationship type editor, and a template browser with application wizard. ~12 files created, ~5 files modified.

## Problem Statement

Epic 315 provides the API for CRUD operations on entity type definitions and Epic 317 provides the template system. But without a UI, admins must use raw API calls to configure case management -- impractical for non-technical users running NLG hotlines or community organizations.

The schema editor must be:
1. **Intuitive** -- admins without technical skills can add fields, configure statuses, and apply templates
2. **Visual** -- drag-and-drop field reordering, color pickers for status badges, icon selection
3. **Safe** -- archiving (not deleting) entity types, deprecation warnings for field removal
4. **Template-driven** -- most admins should start from a template, then customize

## Implementation

### Phase 1: API Verification

This epic is primarily UI work. Phase 1 verifies that the APIs from Epics 315 and 317 exist and are functional. No new API routes are created.

Required API surface from Epic 315:
- `GET /api/settings/entity-types` -- list all entity type definitions
- `POST /api/settings/entity-types` -- create entity type
- `PATCH /api/settings/entity-types/:id` -- update entity type
- `DELETE /api/settings/entity-types/:id` -- archive entity type
- `GET /api/settings/relationship-types` -- list relationship types
- `POST /api/settings/relationship-types` -- create relationship type
- `PATCH /api/settings/relationship-types/:id` -- update relationship type
- `DELETE /api/settings/relationship-types/:id` -- delete relationship type

Required API surface from Epic 317:
- `GET /api/settings/templates` -- list available templates
- `POST /api/settings/templates/apply` -- apply a template
- `GET /api/settings/templates/:id/diff` -- compare installed vs available version

### Phase 2: Desktop UI

#### Task 1: Route + Page Layout

**File**: `src/client/routes/admin/case-management.tsx` (new)

New TanStack Router file route at `/admin/case-management`:

```typescript
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/case-management')({
  component: CaseManagementSettingsPage,
})

function CaseManagementSettingsPage() {
  return (
    <Tabs defaultValue="entity-types">
      <TabsList>
        <TabsTrigger value="entity-types" data-testid="tab-entity-types">
          Entity Types
        </TabsTrigger>
        <TabsTrigger value="relationships" data-testid="tab-relationships">
          Relationships
        </TabsTrigger>
        <TabsTrigger value="templates" data-testid="tab-templates">
          Templates
        </TabsTrigger>
      </TabsList>

      <TabsContent value="entity-types">
        <EntityTypeList />
      </TabsContent>
      <TabsContent value="relationships">
        <RelationshipTypeList />
      </TabsContent>
      <TabsContent value="templates">
        <TemplateBrowser />
      </TabsContent>
    </Tabs>
  )
}
```

Access restricted to users with `cases:manage-types` permission.

#### Task 2: Entity Type List

**File**: `src/client/components/admin-settings/entity-type-list.tsx` (new)

List of all entity type definitions for the hub:

```typescript
interface EntityTypeListProps {
  entityTypes: EntityTypeDefinition[]
  onSelect: (id: string) => void
  onCreate: () => void
  onArchive: (id: string) => void
}
```

UI layout:
- Grid of entity type cards, each showing: icon, name, field count, status count, color swatch
- "New Entity Type" button (top right)
- Each card has edit/archive actions
- Archived types shown at bottom with "Archived" badge and restore option

Key `data-testid` attributes:
- `entity-type-list` -- container
- `entity-type-card-{id}` -- each entity type card
- `entity-type-name-{id}` -- name display
- `entity-type-field-count-{id}` -- field count badge
- `create-entity-type-button` -- create new button
- `archive-entity-type-{id}` -- archive action
- `restore-entity-type-{id}` -- restore archived type

#### Task 3: Entity Type Editor

**File**: `src/client/components/admin-settings/entity-type-editor.tsx` (new)

Full editor for a single entity type definition. Opened in a Sheet (slide-over panel):

```typescript
interface EntityTypeEditorProps {
  entityType: EntityTypeDefinition | null  // null = create mode
  onSave: (definition: EntityTypeDefinition) => void
  onCancel: () => void
  open: boolean
}
```

Editor sections (using Tabs):
1. **General** -- name, label, labelPlural, description, icon selector, color picker, category (case/event/other), numberPrefix, numberingEnabled
2. **Fields** -- FieldEditor component (see Task 4)
3. **Statuses** -- EnumEditor for statuses with color picker and isClosed flag
4. **Severities** -- EnumEditor for severities with color picker and icon selector
5. **Contact Roles** -- EnumEditor for contact roles
6. **Access** -- defaultAccessLevel, accessRoles selector, editRoles selector, piiFields list

Key `data-testid` attributes:
- `entity-type-editor` -- editor root
- `entity-type-editor-name` -- name input
- `entity-type-editor-label` -- label input
- `entity-type-editor-icon` -- icon selector
- `entity-type-editor-color` -- color picker
- `entity-type-editor-category` -- category select
- `entity-type-editor-prefix` -- number prefix input
- `entity-type-editor-save` -- save button
- `entity-type-editor-cancel` -- cancel button
- `entity-type-editor-tab-{section}` -- tab for each section

#### Task 4: Field Editor

**File**: `src/client/components/admin-settings/field-editor.tsx` (new)

Drag-and-drop field list with inline editing:

```typescript
interface FieldEditorProps {
  fields: EntityFieldDefinition[]
  onChange: (fields: EntityFieldDefinition[]) => void
}
```

Each field row shows:
- Drag handle (6-dot grip icon)
- Field name (editable inline)
- Field label (editable inline)
- Type selector dropdown (text, textarea, number, select, multiselect, checkbox, date)
- Required toggle
- Expand arrow to show advanced options

Expanded field options:
- Section grouping (text input)
- Help text (text input)
- Options editor (for select/multiselect types -- add/remove/reorder options)
- Validation rules (min, max, pattern)
- Conditional visibility: showWhen editor (field selector, operator, value)
- Access level: `all`, `assigned`, `admin`
- Indexable toggle + index type selector

"Add Field" button at bottom of list.

Drag-and-drop implemented with `@dnd-kit/core` + `@dnd-kit/sortable` (standard React DnD library, lightweight):

```typescript
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
```

Key `data-testid` attributes:
- `field-list` -- field list container
- `field-row-{name}` -- each field row
- `field-drag-handle-{name}` -- drag handle
- `field-name-input-{name}` -- name input
- `field-label-input-{name}` -- label input
- `field-type-select-{name}` -- type dropdown
- `field-required-toggle-{name}` -- required checkbox
- `field-expand-{name}` -- expand arrow
- `field-options-editor-{name}` -- options editor (select/multiselect)
- `field-access-level-{name}` -- access level selector
- `field-show-when-{name}` -- conditional visibility editor
- `add-field-button` -- add field button
- `remove-field-{name}` -- remove field button

#### Task 5: Enum Editor

**File**: `src/client/components/admin-settings/enum-editor.tsx` (new)

Reusable component for editing ordered lists of enum values (statuses, severities, categories, contact roles):

```typescript
interface EnumEditorProps {
  values: EnumOption[]
  onChange: (values: EnumOption[]) => void
  showColor?: boolean           // Show color picker (statuses, severities)
  showIcon?: boolean            // Show icon selector (severities)
  showClosedFlag?: boolean      // Show "isClosed" toggle (statuses only)
  label: string
}
```

Each enum row:
- Drag handle for reorder
- Value (machine-readable, auto-generated from label, editable)
- Label (display text)
- Color picker (circular swatch, opens color input on click)
- Icon selector (optional, from Lucide icon set)
- isClosed toggle (statuses only -- marks status as terminal)
- Delete button (marks as deprecated, not removed)

Key `data-testid` attributes:
- `enum-editor-{label}` -- editor container
- `enum-row-{value}` -- each enum row
- `enum-value-input-{value}` -- value input
- `enum-label-input-{value}` -- label input
- `enum-color-picker-{value}` -- color picker
- `enum-closed-toggle-{value}` -- isClosed toggle
- `add-enum-button-{label}` -- add value button
- `remove-enum-{value}` -- remove/deprecate button

#### Task 6: Relationship Type Editor

**File**: `src/client/components/admin-settings/relationship-type-editor.tsx` (new)

Editor for relationship type definitions:

```typescript
interface RelationshipTypeEditorProps {
  relationshipType: RelationshipTypeDefinition | null
  entityTypes: EntityTypeDefinition[]  // For source/target selection
  onSave: (definition: RelationshipTypeDefinition) => void
  onCancel: () => void
  open: boolean
}
```

Fields:
- Source entity type (dropdown)
- Target entity type (dropdown)
- Cardinality (1:1, 1:N, M:N)
- Label / reverse label
- Source label / target label
- Roles (if M:N -- reuses EnumEditor)
- Default role
- Cascade delete toggle
- Required toggle

Key `data-testid` attributes:
- `relationship-editor` -- editor root
- `relationship-source-type` -- source type dropdown
- `relationship-target-type` -- target type dropdown
- `relationship-cardinality` -- cardinality selector
- `relationship-label` -- label input
- `relationship-save` -- save button
- `relationship-cancel` -- cancel button

#### Task 7: Template Browser

**File**: `src/client/components/admin-settings/template-browser.tsx` (new)

Grid of available templates:

```typescript
interface TemplateBrowserProps {
  templates: CaseManagementTemplate[]
  installedTemplates: InstalledTemplateInfo[]
  onApply: (templateId: string) => void
}
```

Each template card shows:
- Template name + description
- Tags (as badges)
- Entity type count + relationship type count
- "Apply" button (or "Update Available" if newer version exists)
- "Applied" badge with version if already installed

Key `data-testid` attributes:
- `template-browser` -- browser container
- `template-card-{id}` -- each template card
- `template-name-{id}` -- template name
- `template-tags-{id}` -- tag badges
- `template-apply-{id}` -- apply button
- `template-update-{id}` -- update button (when newer version available)
- `template-applied-badge-{id}` -- installed indicator

#### Task 8: Template Application Wizard

**File**: `src/client/components/admin-settings/template-wizard.tsx` (new)

Multi-step wizard shown when "Apply" is clicked:

```typescript
interface TemplateWizardProps {
  template: CaseManagementTemplate
  open: boolean
  onComplete: () => void
  onCancel: () => void
}
```

Steps:
1. **Review** -- shows what will be created: entity types, relationship types, fields, suggested roles
2. **Roles** -- optional: create suggested roles with checkboxes (pre-checked)
3. **Confirm** -- summary of what will be applied, "Apply Template" button

Key `data-testid` attributes:
- `template-wizard` -- wizard dialog
- `template-wizard-step-{number}` -- step indicator
- `template-wizard-entity-{name}` -- entity type preview row
- `template-wizard-role-{slug}` -- role checkbox
- `template-wizard-apply` -- final apply button
- `template-wizard-cancel` -- cancel button
- `template-wizard-next` -- next step button
- `template-wizard-back` -- back step button

#### Task 9: Admin Settings Navigation

**File**: `src/client/routes/admin/settings.tsx` (modify)

Add "Case Management" tab to admin settings, or link from admin settings to the new route:

```typescript
// Add navigation entry to admin settings sidebar/tabs:
{
  label: t('admin.caseManagement'),
  href: '/admin/case-management',
  icon: Briefcase,
  permission: 'cases:manage-types',
  testId: 'nav-case-management',
}
```

#### Task 10: i18n Strings

**File**: `packages/i18n/locales/en.json` (modify)

```json
{
  "schemaEditor": {
    "title": "Case Management Configuration",
    "entityTypes": "Entity Types",
    "relationships": "Relationships",
    "templates": "Templates",
    "createEntityType": "New Entity Type",
    "editEntityType": "Edit Entity Type",
    "archiveEntityType": "Archive Entity Type",
    "archiveConfirm": "Archive this entity type? Existing records will be preserved but new records cannot be created.",
    "restoreEntityType": "Restore",
    "general": "General",
    "fields": "Fields",
    "statuses": "Statuses",
    "severities": "Severities",
    "contactRoles": "Contact Roles",
    "access": "Access Control",
    "addField": "Add Field",
    "removeField": "Remove Field",
    "fieldName": "Field Name",
    "fieldLabel": "Label",
    "fieldType": "Type",
    "fieldRequired": "Required",
    "fieldSection": "Section",
    "fieldHelpText": "Help Text",
    "fieldOptions": "Options",
    "fieldAccessLevel": "Access Level",
    "fieldConditional": "Show When",
    "addOption": "Add Option",
    "removeOption": "Remove Option",
    "addStatus": "Add Status",
    "addSeverity": "Add Severity",
    "addContactRole": "Add Contact Role",
    "closedStatus": "Closed (terminal)",
    "defaultStatus": "Default",
    "entityName": "Name",
    "entityLabel": "Display Label",
    "entityLabelPlural": "Plural Label",
    "entityDescription": "Description",
    "entityIcon": "Icon",
    "entityColor": "Color",
    "entityCategory": "Category",
    "entityNumberPrefix": "Number Prefix",
    "entityNumbering": "Auto-numbering",
    "accessRoles": "Roles with access",
    "editRoles": "Roles with edit access",
    "piiFields": "PII Fields",
    "templateBrowser": "Template Browser",
    "applyTemplate": "Apply Template",
    "updateAvailable": "Update Available",
    "applied": "Applied",
    "templateWizard": "Apply Template",
    "wizardReview": "Review",
    "wizardRoles": "Roles",
    "wizardConfirm": "Confirm",
    "wizardApply": "Apply Template",
    "willCreate": "Will create",
    "createRoles": "Create suggested roles",
    "relationshipEditor": "Relationship Type",
    "sourceType": "Source Entity Type",
    "targetType": "Target Entity Type",
    "cardinality": "Cardinality",
    "label": "Label",
    "reverseLabel": "Reverse Label",
    "cascadeDelete": "Cascade Delete",
    "requiredRelationship": "Required"
  }
}
```

#### Task 11: BDD Feature File

**File**: `packages/test-specs/features/platform/desktop/cases/schema-editor.feature` (new)

```gherkin
@desktop
Feature: Schema Editor & Template Browser (Desktop)
  Admin can manage entity type definitions, fields, and templates
  via the case management settings page.

  Background:
    Given the user is logged in as an admin
    And the user has "cases:manage-types" permission
    And case management is enabled

  @schema-editor
  Scenario: Navigate to case management settings
    When the user navigates to "/admin/case-management"
    Then the "Entity Types" tab should be active
    And the entity type list should be visible

  @schema-editor
  Scenario: Create a new entity type
    Given the user is on the case management settings page
    When the user clicks "New Entity Type"
    And fills in:
      | name        | eviction_case       |
      | label       | Eviction Case       |
      | labelPlural | Eviction Cases      |
      | category    | case                |
      | prefix      | EV                  |
    And clicks "Save"
    Then the entity type "eviction_case" should appear in the list
    And a success toast should be visible

  @schema-editor
  Scenario: Add a field to an entity type
    Given entity type "eviction_case" exists
    When the user opens the editor for "eviction_case"
    And navigates to the "Fields" tab
    And clicks "Add Field"
    And fills in field details:
      | name     | court_date |
      | label    | Court Date |
      | type     | text       |
      | required | true       |
    And clicks "Save"
    Then the entity type should have a field "court_date"

  @schema-editor
  Scenario: Reorder fields via drag and drop
    Given entity type "eviction_case" has fields "field_a", "field_b", "field_c"
    When the user drags "field_c" above "field_a"
    And clicks "Save"
    Then the field order should be "field_c", "field_a", "field_b"

  @schema-editor
  Scenario: Archive an entity type
    Given entity type "eviction_case" exists
    When the user clicks "Archive" on "eviction_case"
    And confirms the archive action
    Then "eviction_case" should be shown as archived
    And a restore option should be available

  @schema-editor @templates
  Scenario: Browse available templates
    When the user navigates to the "Templates" tab
    Then the template browser should show available templates
    And each template should display name, description, and tags

  @schema-editor @templates
  Scenario: Apply a template
    Given template "jail-support" is available
    When the user clicks "Apply" on "jail-support"
    Then the template wizard should open
    And it should show the entity types that will be created
    When the user clicks "Apply Template"
    Then the entity types from the template should be created
    And a success toast should be visible

  @schema-editor @templates
  Scenario: Template wizard with role creation
    Given template "jail-support" is available
    When the user applies "jail-support" via the wizard
    And checks "Create suggested roles"
    Then roles "Hotline Coordinator", "Intake Volunteer" should be created
```

## Files to Create

| File | Purpose |
|------|---------|
| `src/client/routes/admin/case-management.tsx` | Route + page layout |
| `src/client/components/admin-settings/entity-type-list.tsx` | Entity type card grid |
| `src/client/components/admin-settings/entity-type-editor.tsx` | Entity type editor panel |
| `src/client/components/admin-settings/field-editor.tsx` | Drag-and-drop field editor |
| `src/client/components/admin-settings/enum-editor.tsx` | Reusable enum value editor |
| `src/client/components/admin-settings/relationship-type-editor.tsx` | Relationship type editor |
| `src/client/components/admin-settings/template-browser.tsx` | Template card grid |
| `src/client/components/admin-settings/template-wizard.tsx` | Template application wizard |
| `packages/test-specs/features/platform/desktop/cases/schema-editor.feature` | Desktop BDD scenarios |
| `tests/steps/cases/schema-editor-steps.ts` | Desktop step definitions |

## Files to Modify

| File | Change |
|------|--------|
| `src/client/routes/admin/settings.tsx` | Add case management nav link |
| `src/client/routes/__root.tsx` | Register new route (if not auto-discovered) |
| `packages/i18n/locales/en.json` | Add schemaEditor i18n section |
| `packages/i18n/locales/*.json` | Propagate to all 13 locales |
| `tests/test-ids.ts` | Add schema editor test IDs |

## Testing

### Desktop BDD
- `bun run test:desktop` -- 8 scenarios in `schema-editor.feature`

### Dependencies
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` -- drag-and-drop for field reorder

## Acceptance Criteria & Test Scenarios

- [ ] Admin can navigate to case management settings
  -> `packages/test-specs/features/platform/desktop/cases/schema-editor.feature: "Navigate to case management settings"`
- [ ] Entity types can be created via UI
  -> `packages/test-specs/features/platform/desktop/cases/schema-editor.feature: "Create a new entity type"`
- [ ] Fields can be added to entity types
  -> `packages/test-specs/features/platform/desktop/cases/schema-editor.feature: "Add a field to an entity type"`
- [ ] Fields can be reordered via drag-and-drop
  -> `packages/test-specs/features/platform/desktop/cases/schema-editor.feature: "Reorder fields via drag and drop"`
- [ ] Entity types can be archived
  -> `packages/test-specs/features/platform/desktop/cases/schema-editor.feature: "Archive an entity type"`
- [ ] Template browser shows available templates
  -> `packages/test-specs/features/platform/desktop/cases/schema-editor.feature: "Browse available templates"`
- [ ] Templates can be applied via wizard
  -> `packages/test-specs/features/platform/desktop/cases/schema-editor.feature: "Apply a template"`
- [ ] Template wizard offers role creation
  -> `packages/test-specs/features/platform/desktop/cases/schema-editor.feature: "Template wizard with role creation"`
- [ ] All platform BDD suites pass
- [ ] Backlog files updated

## Feature Files

| File | Status | Description |
|------|--------|-------------|
| `packages/test-specs/features/platform/desktop/cases/schema-editor.feature` | New | 8 desktop scenarios for schema editor + template browser |
| `tests/steps/cases/schema-editor-steps.ts` | New | Desktop step definitions |

## Risk Assessment

- **Medium risk**: Drag-and-drop field editor (Task 4) -- DnD libraries can have accessibility and mobile interaction issues. Mitigated by using `@dnd-kit` which has built-in keyboard sensor support and is the current standard React DnD library. Playwright testing will verify DnD interaction via keyboard events.
- **Medium risk**: Complex form state (Task 3) -- entity type editor has many interconnected fields across multiple tabs. State management could become unwieldy. Mitigated by using a single controlled form state object and saving on explicit "Save" action (not auto-save).
- **Low risk**: Template wizard (Task 8) -- multi-step wizard is a standard pattern. Uses shadcn/ui Dialog with step state management.
- **Low risk**: Route setup (Task 1) -- straightforward TanStack Router file-based route following existing admin settings patterns.

## Execution

- **Phase 1**: Verify Epic 315 + 317 APIs are functional (no new code)
- **Phase 2**: Route -> EntityTypeList -> EntityTypeEditor -> FieldEditor -> EnumEditor -> RelationshipTypeEditor -> TemplateBrowser -> TemplateWizard -> Admin nav -> i18n -> BDD -> gate
- **Phase 3**: `bun run test:all`
