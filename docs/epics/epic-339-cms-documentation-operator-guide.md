# Epic 339: CMS Documentation & Operator Guide

**Status**: PENDING
**Priority**: Low
**Depends on**: Epics 315-332 (CMS backend + desktop UI complete)
**Blocks**: None
**Branch**: `desktop`

## Summary

Create in-app contextual help for the CMS UI (tooltip components on key elements), extend the operator handbook with a case management section, write a template authoring guide, and add narrative API documentation for CMS endpoints alongside the existing OpenAPI spec.

## Problem Statement

The CMS is feature-complete but has zero user-facing documentation. Operators deploying Llamenos for jail support or street medic work need to understand:

1. **How to enable and configure CMS** -- non-obvious because it requires enabling CMS, applying a template, and optionally customizing entity types
2. **What templates mean** -- the 13 pre-built templates serve different use cases; picking the wrong one wastes setup time
3. **How encryption tiers work** -- admins need to understand which fields are visible to whom
4. **How to create custom templates** -- advanced orgs want to define their own entity types, fields, and statuses
5. **How the API works** -- integrators building bots or dashboards need narrative docs beyond raw OpenAPI

Without documentation, users will misconfigure the system, create insecure field visibility settings, or fail to apply templates correctly.

## Implementation

### 1. In-App Contextual Help

Add tooltip help icons to key CMS UI elements. Each tooltip shows a brief explanation with an optional "Learn more" link to the handbook.

**Component**: `src/client/components/ui/help-tooltip.tsx`

```typescript
interface HelpTooltipProps {
  helpKey: string          // i18n key under "help.*"
  learnMoreUrl?: string    // Link to handbook section
}
```

Uses shadcn/ui `Tooltip` with an `Info` icon trigger. Content comes from `t(`help.${helpKey}`)`.

**Placement** (add `HelpTooltip` next to these elements):

| Location | helpKey | Content |
|----------|---------|---------|
| CMS enable toggle | `help.cmsToggle` | "Enables the case management system for this hub. Once enabled, you can apply templates and create cases." |
| Template browser header | `help.templates` | "Templates pre-configure entity types, fields, and statuses for common use cases. You can customize after applying." |
| Entity type editor | `help.entityTypes` | "Entity types define the structure of your cases. Each type has its own fields, statuses, and permissions." |
| Field access level selector | `help.fieldAccessLevel` | "Controls who can see this field. 'All' = anyone with case access. 'Assigned' = assigned volunteer + admins. 'Admin' = admins only." |
| Encryption badge | `help.encryptionTiers` | "Fields are encrypted at different levels. Blue = team-visible. Purple = assigned + admins. Red = admins only." |
| Contact directory search | `help.encryptedSearch` | "Search is performed using encrypted tokens. The server never sees your search query in plaintext." |
| Status pill (detail) | `help.statusChange` | "Click to change the case status. Status changes are logged in the timeline." |
| Bulk actions bar | `help.bulkActions` | "Select multiple cases using checkboxes, then use these actions to update all selected cases at once." |
| Offline indicator (mobile) | `help.offlineQueue` | "Changes made while offline are queued and will sync when you reconnect." |

Add i18n keys to `packages/i18n/locales/en.json` under `help.*`, with ES translations in `es.json`.

### 2. Operator Handbook: Case Management Section

Extend `docs/operator-handbook.md` (or create if it does not exist) with a new section.

**File**: `docs/operator-handbook.md` (modify or create)

Sections to add:

#### 2.1 Enabling Case Management
- Navigate to Hub Settings > Case Management
- Toggle the CMS enable switch
- What happens when CMS is enabled (new nav items, new API endpoints)
- What happens when CMS is disabled (cases are preserved but hidden)

#### 2.2 Applying a Template
- Overview of the 13 built-in templates with use case descriptions:

| Template | Use Case | Entity Types | Fields |
|----------|----------|-------------|--------|
| Jail Support | Protest arrest tracking | Arrest Case, Support Ticket | 37 fields |
| Street Medic | Field medical encounters | Medical Encounter | 13 fields |
| ICE Rapid Response | Immigration enforcement | Detention Case, Family Separation | 35 fields |
| Bail Fund | Bail payment tracking | Bail Case | 20 fields |
| DV Crisis | Domestic violence crisis | DV Case (all PII) | 30 fields |
| Anti-Trafficking | Trafficking victim support | Trafficking Case | 25 fields |
| Hate Crime Reporting | Incident documentation | Hate Crime Report | 20 fields |
| Copwatch | Police accountability | Officer Interaction | 20 fields |
| Tenant Organizing | Housing rights | Tenant Case | 20 fields |
| Mutual Aid | Resource distribution | Aid Request | 15 fields |
| Missing Persons | Missing person cases | Missing Person Case | 25 fields |
| KYR Training | Know Your Rights tracking | Training Session | 15 fields |
| General Hotline | Generic case tracking | Case | 7 fields |

- How to apply: click "Apply" on the template card
- What "Applied" badge means (template already applied, entity types exist)
- Can you apply multiple templates? Yes -- entity types are additive
- Can you undo a template? No, but you can archive entity types

#### 2.3 Understanding Encryption Tiers
- Summary tier (blue shield): visible to anyone with case access
- Fields tier (purple shield): visible to assigned volunteer + admins
- PII tier (red shield): visible to admins only
- How this maps to field `accessLevel` in the entity type definition
- Example: in jail support, attorney name is PII (red), charges are summary (blue)
- Why DV Crisis template marks ALL fields as PII

#### 2.4 Creating and Managing Cases
- How to create a new case
- How to change status
- How to assign volunteers
- How to link contacts
- How to use the timeline
- How to upload evidence
- Bulk operations for mass arrest situations

#### 2.5 Contact Directory
- Creating contacts
- Search (encrypted)
- Linking contacts to cases with roles
- Understanding "Restricted" contacts (PII you cannot decrypt)

### 3. Template Authoring Guide

**File**: `docs/template-authoring.md` (new)

For advanced operators who want to create custom templates:

#### 3.1 Template File Structure
- JSON schema reference
- Required fields: `id`, `name`, `description`, `version`, `entityTypes`
- Entity type definition: `name`, `label`, `labelPlural`, `category`, `statuses`, `fields`, `severities`, `contactRoles`
- Field definition: `name`, `label`, `type`, `section`, `order`, `accessLevel`, `required`, `showWhen`, `validation`

#### 3.2 Field Types
- `text`, `textarea`, `number`, `select`, `multiselect`, `checkbox`, `date`, `file`
- Select/multiselect options: `{ value, label }`
- Conditional visibility with `showWhen`: `{ field, operator, value }`

#### 3.3 Access Levels
- `all` -- encrypted at summary tier (searchable)
- `assigned` -- encrypted at fields tier (assigned volunteer + admins)
- `admin` -- encrypted at PII tier (admins only)
- Security implications of each level

#### 3.4 Statuses and Severities
- Status definition: `{ value, label, color, order, isDefault?, isClosed? }`
- One status must have `isDefault: true`
- Closed statuses mark the case as resolved
- Severity definition: `{ value, label, color, order }`

#### 3.5 Validation
- Templates are validated by Zod at build time (`packages/protocol/tools/codegen.ts`)
- Run `bun run codegen` to validate after editing
- Common validation errors and fixes

#### 3.6 Example: Creating a Custom Template
Walk through creating a "Tenant Eviction" template from scratch.

### 4. CMS API Narrative Documentation

**File**: `docs/api/case-management.md` (new)

Narrative docs for CMS endpoints. The OpenAPI spec (`packages/protocol/openapi-snapshot.json`) has the raw schema; this adds context, examples, and common patterns.

Sections:
- Authentication (Schnorr token, same as all other endpoints)
- Enabling CMS: `PATCH /api/settings` with `{ caseManagementEnabled: true }`
- Entity type CRUD: `GET/POST/PATCH/DELETE /api/settings/entity-types`
- Template application: `POST /api/settings/templates/:id/apply`
- Record CRUD: `GET/POST/PATCH/DELETE /api/records`
- Record interactions: `GET/POST /api/records/:id/interactions`
- Record evidence: `GET/POST /api/records/:id/evidence`
- Contact CRUD: `GET/POST/PATCH/DELETE /api/contacts`
- Contact search: `GET /api/contacts?q={encryptedTokens}`
- Contact relationships: `GET/POST/DELETE /api/contacts/:id/relationships`
- Contact groups: `GET/POST /api/contacts/groups`
- Record-contact linking: `GET/POST/DELETE /api/records/:id/contacts`
- Event linking: `POST /api/records/:eventId/links`
- Encryption: how to encrypt/decrypt record payloads (3-tier envelope pattern)
- Blind index: how to compute search tokens client-side

Each endpoint includes: method, path, auth requirements, request body example, response example, error codes.

## Files to Create

| File | Purpose |
|------|---------|
| `src/client/components/ui/help-tooltip.tsx` | Reusable contextual help tooltip component |
| `docs/template-authoring.md` | Template authoring guide for advanced operators |
| `docs/api/case-management.md` | CMS API narrative documentation |

## Files to Modify

| File | Change |
|------|--------|
| `docs/operator-handbook.md` | Add case management section (or create if missing) |
| `packages/i18n/locales/en.json` | Add `help.*` keys (~10 entries) |
| `packages/i18n/locales/es.json` | Add `help.*` keys (ES translations) |
| `src/client/components/admin/case-management-section.tsx` | Add HelpTooltip next to toggle |
| `src/client/components/admin/template-browser.tsx` | Add HelpTooltip next to header |
| `src/client/components/cases/SchemaForm.tsx` | Add HelpTooltip next to access level selector |
| `src/client/components/cases/StatusPill.tsx` | Add HelpTooltip next to pill |
| `src/client/components/cases/BulkActionsBar.tsx` | Add HelpTooltip next to toolbar |

## Testing

```bash
# Verify help tooltip renders
bun run test:desktop  # BDD scenarios should not break from added tooltips

# Verify i18n keys exist
bun run i18n:validate:desktop

# Typecheck
bun run typecheck
```

No dedicated BDD scenarios for documentation -- the tooltips are additive UI and should not affect existing test selectors.

## Acceptance Criteria

- [ ] HelpTooltip component renders on 8+ CMS UI elements
- [ ] Operator handbook has a complete case management section with template descriptions
- [ ] Template authoring guide covers all field types, access levels, statuses, and validation
- [ ] API narrative docs cover all CMS endpoints with examples
- [ ] `help.*` i18n keys added to en.json and es.json
- [ ] `bun run i18n:validate:desktop` passes
- [ ] `bun run typecheck` passes
- [ ] No existing BDD scenarios regress from tooltip additions

## Risk Assessment

- **Low**: Tooltips are purely additive -- they don't change component behavior or test IDs.
- **Low**: Documentation is in markdown files -- no runtime impact.
- **Medium**: API narrative docs may drift from actual API as endpoints evolve. Mitigated by referencing the OpenAPI snapshot and adding a note to update docs when routes change.
