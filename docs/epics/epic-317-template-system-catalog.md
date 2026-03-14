# Epic 317: Template System & Catalog

**Status**: PENDING
**Priority**: High
**Depends on**: Epic 315 (Entity Schema Engine)
**Blocks**: Epic 329 (Desktop Schema Editor)
**Branch**: `desktop`

## Summary

Build the template loading, validation, application, composition, and update detection system. Templates are JSON configuration packages that bootstrap a hub's case management schema with entity types, relationship types, suggested roles, and i18n labels for specific use cases (jail support, street medic, ICE rapid response, etc.). Ships with 13 pre-built templates in `packages/protocol/templates/`. Includes a JSON Schema for template validation, a `POST /api/settings/templates/apply` endpoint, template composition via `extends`, and template update detection. ~20 files created.

## Problem Statement

Without templates, every hub admin would need to manually create entity types, define fields, configure statuses, and set up relationship types from scratch. This requires deep domain knowledge (what fields does a jail support case need? what statuses? what roles?) and is error-prone.

Templates solve this by packaging expert knowledge into importable configurations. An NLG chapter can apply the "Jail Support" template and immediately have:
- An "Arrest Case" entity type with 18 domain-specific fields
- A "Mass Arrest Event" entity type
- Contact-to-case and case-to-event relationship types
- Suggested roles (Hotline Coordinator, Intake Volunteer, Jail Support Coordinator, Attorney Coordinator)
- i18n labels in English and Spanish

The template system must support:
- **Composition**: Apply multiple templates (jail support + street medic)
- **Customization**: Admin can modify any imported configuration
- **Updates**: When the app ships a newer template version, admin can review and apply changes
- **Validation**: Templates are validated against a JSON Schema at build time

## Implementation

### Phase 1: API + Shared Specs

#### Task 1: Template Type Definition

**File**: `packages/protocol/template-types.ts` (new)

```typescript
import { z } from 'zod'
import type { EntityTypeDefinition, RelationshipTypeDefinition, EnumOption } from '@worker/schemas/entity-schema'

export const templateManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().max(100),
  description: z.string().max(1000),
  author: z.string().max(100),
  license: z.string().max(50).optional(),
  tags: z.array(z.string().max(50)).max(20),

  extends: z.array(z.string()).default([]),

  labels: z.record(
    z.string(), // locale code
    z.record(z.string(), z.string()),
  ),

  entityTypes: z.array(z.object({
    name: z.string(),
    label: z.string(),
    labelPlural: z.string(),
    description: z.string(),
    icon: z.string().optional(),
    color: z.string().optional(),
    category: z.enum(['contact', 'case', 'event', 'custom']),
    numberPrefix: z.string().optional(),
    numberingEnabled: z.boolean().default(false),
    defaultAccessLevel: z.enum(['assigned', 'team', 'hub']).default('assigned'),
    piiFields: z.array(z.string()).default([]),
    allowSubRecords: z.boolean().default(false),
    allowFileAttachments: z.boolean().default(true),
    allowInteractionLinks: z.boolean().default(true),
    showInNavigation: z.boolean().default(true),
    showInDashboard: z.boolean().default(false),
    statuses: z.array(z.object({
      value: z.string(),
      label: z.string(),
      color: z.string().optional(),
      icon: z.string().optional(),
      order: z.number(),
      isClosed: z.boolean().optional(),
    })),
    defaultStatus: z.string(),
    closedStatuses: z.array(z.string()),
    severities: z.array(z.object({
      value: z.string(),
      label: z.string(),
      color: z.string().optional(),
      icon: z.string().optional(),
      order: z.number(),
    })).optional(),
    defaultSeverity: z.string().optional(),
    categories: z.array(z.object({
      value: z.string(),
      label: z.string(),
      order: z.number(),
    })).optional(),
    contactRoles: z.array(z.object({
      value: z.string(),
      label: z.string(),
      order: z.number(),
    })).optional(),
    fields: z.array(z.object({
      name: z.string(),
      label: z.string(),
      type: z.enum(['text', 'number', 'select', 'multiselect', 'checkbox', 'textarea', 'date', 'file']),
      required: z.boolean().default(false),
      options: z.array(z.object({
        key: z.string(),
        label: z.string(),
      })).optional(),
      section: z.string().optional(),
      helpText: z.string().optional(),
      order: z.number(),
      indexable: z.boolean().default(false),
      indexType: z.enum(['exact', 'none']).default('none'),
      accessLevel: z.enum(['all', 'admin', 'assigned', 'custom']).default('all'),
      showWhen: z.object({
        field: z.string(),
        operator: z.enum(['equals', 'not_equals', 'contains', 'is_set']),
        value: z.union([z.string(), z.number(), z.boolean()]).optional(),
      }).optional(),
      hubEditable: z.boolean().default(true),
    })),
  })),

  relationshipTypes: z.array(z.object({
    sourceEntityTypeName: z.string(),
    targetEntityTypeName: z.string(),
    cardinality: z.enum(['1:1', '1:N', 'M:N']),
    label: z.string(),
    reverseLabel: z.string(),
    sourceLabel: z.string(),
    targetLabel: z.string(),
    roles: z.array(z.object({
      value: z.string(),
      label: z.string(),
      order: z.number(),
    })).optional(),
    defaultRole: z.string().optional(),
    cascadeDelete: z.boolean().default(false),
    required: z.boolean().default(false),
  })).default([]),

  suggestedRoles: z.array(z.object({
    name: z.string(),
    slug: z.string(),
    description: z.string(),
    permissions: z.array(z.string()),
  })).default([]),
})

export type CaseManagementTemplate = z.infer<typeof templateManifestSchema>
```

#### Task 2: Template JSON Files (13 templates)

**Directory**: `packages/protocol/templates/`

Create template JSON files for each use case. Full JSON for the first 3 templates, abbreviated for the rest (field lists defined in `docs/plans/2026-03-14-case-management-use-cases.md`):

| File | Template ID | Entity Types | Key Fields |
|------|------------|-------------|-----------|
| `jail-support.json` | `jail-support` | arrest_case, mass_arrest_event | 18 fields (see use case catalog) |
| `street-medic.json` | `street-medic` | medical_encounter | 10 fields |
| `ice-rapid-response.json` | `ice-rapid-response` | immigration_case, ice_operation | 15 fields |
| `bail-fund.json` | `bail-fund` | bail_fund_case | 14 fields |
| `dv-crisis.json` | `dv-crisis` | safety_plan_case | 15 fields |
| `anti-trafficking.json` | `anti-trafficking` | trafficking_case | 12 fields |
| `hate-crime-reporting.json` | `hate-crime-reporting` | bias_incident, incident_cluster | 12 fields |
| `copwatch.json` | `copwatch` | police_conduct_case | 14 fields |
| `tenant-organizing.json` | `tenant-organizing` | eviction_defense_case | 17 fields |
| `mutual-aid.json` | `mutual-aid` | aid_request | 13 fields |
| `missing-persons.json` | `missing-persons` | missing_person_case | 15 fields |
| `general-hotline.json` | `general-hotline` | general_case | 4 fields |
| `kyr-training.json` | `kyr-training` | community_training (event) | 6 fields |

Each template includes English labels. Spanish labels included for `jail-support`, `ice-rapid-response`, and `general-hotline` (highest priority for bilingual operations).

#### Task 3: Template Validation Script

**File**: `packages/protocol/tools/validate-templates.ts` (new)

```typescript
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { templateManifestSchema } from '../template-types'

const templatesDir = join(__dirname, '..', 'templates')
const files = readdirSync(templatesDir).filter(f => f.endsWith('.json'))

let errors = 0

for (const file of files) {
  const path = join(templatesDir, file)
  const content = JSON.parse(readFileSync(path, 'utf-8'))
  const result = templateManifestSchema.safeParse(content)

  if (!result.success) {
    console.error(`FAIL: ${file}`)
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`)
    }
    errors++
  } else {
    // Validate internal consistency
    const template = result.data
    for (const et of template.entityTypes) {
      // defaultStatus must be in statuses
      if (!et.statuses.some(s => s.value === et.defaultStatus)) {
        console.error(`FAIL: ${file} — entity "${et.name}" defaultStatus "${et.defaultStatus}" not in statuses`)
        errors++
      }
      // closedStatuses must all be in statuses
      for (const cs of et.closedStatuses) {
        if (!et.statuses.some(s => s.value === cs)) {
          console.error(`FAIL: ${file} — entity "${et.name}" closedStatus "${cs}" not in statuses`)
          errors++
        }
      }
      // showWhen field references must exist
      for (const field of et.fields) {
        if (field.showWhen && !et.fields.some(f => f.name === field.showWhen!.field)) {
          console.error(`FAIL: ${file} — field "${field.name}" showWhen references nonexistent field "${field.showWhen.field}"`)
          errors++
        }
      }
    }

    // Validate relationship type references
    for (const rt of template.relationshipTypes) {
      const entityNames = ['contact', ...template.entityTypes.map(e => e.name)]
      if (!entityNames.includes(rt.sourceEntityTypeName)) {
        console.error(`FAIL: ${file} — relationship source "${rt.sourceEntityTypeName}" not found`)
        errors++
      }
      if (!entityNames.includes(rt.targetEntityTypeName)) {
        console.error(`FAIL: ${file} — relationship target "${rt.targetEntityTypeName}" not found`)
        errors++
      }
    }

    // Validate extends references
    for (const ext of template.extends) {
      if (!files.some(f => f === `${ext}.json`)) {
        console.error(`FAIL: ${file} — extends "${ext}" template file not found`)
        errors++
      }
    }

    if (errors === 0) console.log(`PASS: ${file}`)
  }
}

if (errors > 0) {
  console.error(`\n${errors} error(s) found`)
  process.exit(1)
} else {
  console.log(`\nAll ${files.length} templates valid`)
}
```

**Package.json script**: `"templates:validate": "bun run packages/protocol/tools/validate-templates.ts"`

#### Task 4: Template Application Logic

**File**: `apps/worker/lib/template-engine.ts` (new)

```typescript
import type { CaseManagementTemplate } from '@protocol/template-types'
import type { EntityTypeDefinition, RelationshipTypeDefinition } from '../schemas/entity-schema'

interface AppliedTemplateRecord {
  templateId: string
  templateVersion: string
  appliedAt: string
  entityTypeIds: string[]
  relationshipTypeIds: string[]
}

/**
 * Apply a template to a hub, creating entity types and relationship types.
 * If the template extends others, apply parents first (depth-first).
 */
export async function applyTemplate(
  template: CaseManagementTemplate,
  hubId: string,
  allTemplates: Map<string, CaseManagementTemplate>,
  existingEntityTypes: EntityTypeDefinition[],
  existingRelationshipTypes: RelationshipTypeDefinition[],
): Promise<{
  entityTypes: EntityTypeDefinition[]
  relationshipTypes: RelationshipTypeDefinition[]
  appliedRecord: AppliedTemplateRecord
}> {
  // 1. Resolve extends chain (depth-first)
  const resolvedTypes = new Map<string, CaseManagementTemplate['entityTypes'][0]>()
  const resolvedRelationships: CaseManagementTemplate['relationshipTypes'] = []

  for (const parentId of template.extends) {
    const parent = allTemplates.get(parentId)
    if (!parent) throw new Error(`Extended template "${parentId}" not found`)
    // Recursively resolve parent's extends
    const parentResult = await applyTemplate(parent, hubId, allTemplates, existingEntityTypes, existingRelationshipTypes)
    // Merge parent types (parent types can be overridden by child)
    for (const et of parent.entityTypes) {
      resolvedTypes.set(et.name, et)
    }
    resolvedRelationships.push(...parent.relationshipTypes)
  }

  // 2. Apply this template's types (overrides parents for same name)
  for (const et of template.entityTypes) {
    resolvedTypes.set(et.name, et)
  }
  resolvedRelationships.push(...template.relationshipTypes)

  // 3. Convert template entity types to EntityTypeDefinitions
  const createdEntityTypes: EntityTypeDefinition[] = []
  const entityNameToId = new Map<string, string>()

  // Map existing entity type names to IDs (for idempotent re-application)
  for (const existing of existingEntityTypes) {
    entityNameToId.set(existing.name, existing.id)
  }

  for (const [, templateET] of resolvedTypes) {
    const existingId = entityNameToId.get(templateET.name)
    const id = existingId || crypto.randomUUID()
    const now = new Date().toISOString()

    const entityType: EntityTypeDefinition = {
      id,
      hubId,
      name: templateET.name,
      label: resolveLabel(template.labels, templateET.label),
      labelPlural: resolveLabel(template.labels, templateET.labelPlural),
      description: resolveLabel(template.labels, templateET.description),
      icon: templateET.icon,
      color: templateET.color,
      category: templateET.category,
      templateId: template.id,
      templateVersion: template.version,
      fields: templateET.fields.map((f, i) => ({
        id: crypto.randomUUID(),
        name: f.name,
        label: resolveLabel(template.labels, f.label),
        type: f.type,
        required: f.required,
        options: f.options?.map(o => ({
          key: o.key,
          label: resolveLabel(template.labels, o.label),
        })),
        section: f.section,
        helpText: f.helpText ? resolveLabel(template.labels, f.helpText) : undefined,
        order: f.order ?? i,
        indexable: f.indexable,
        indexType: f.indexType ?? 'none',
        accessLevel: f.accessLevel ?? 'all',
        visibleToVolunteers: true,
        editableByVolunteers: true,
        showWhen: f.showWhen,
        templateId: template.id,
        hubEditable: f.hubEditable ?? true,
        createdAt: now,
      })),
      statuses: templateET.statuses.map(s => ({
        ...s,
        label: resolveLabel(template.labels, s.label),
      })),
      defaultStatus: templateET.defaultStatus,
      closedStatuses: templateET.closedStatuses,
      severities: templateET.severities?.map(s => ({
        ...s,
        label: resolveLabel(template.labels, s.label),
      })),
      defaultSeverity: templateET.defaultSeverity,
      categories: templateET.categories?.map(c => ({
        ...c,
        label: resolveLabel(template.labels, c.label),
      })),
      contactRoles: templateET.contactRoles?.map(r => ({
        ...r,
        label: resolveLabel(template.labels, r.label),
      })),
      numberPrefix: templateET.numberPrefix,
      numberingEnabled: templateET.numberingEnabled,
      defaultAccessLevel: templateET.defaultAccessLevel,
      piiFields: templateET.piiFields,
      allowSubRecords: templateET.allowSubRecords,
      allowFileAttachments: templateET.allowFileAttachments,
      allowInteractionLinks: templateET.allowInteractionLinks,
      showInNavigation: templateET.showInNavigation,
      showInDashboard: templateET.showInDashboard,
      isArchived: false,
      isSystem: false,
      createdAt: existingId ? (existingEntityTypes.find(e => e.id === existingId)?.createdAt ?? now) : now,
      updatedAt: now,
    }

    entityNameToId.set(templateET.name, id)
    createdEntityTypes.push(entityType)
  }

  // 4. Convert relationship types
  const createdRelationshipTypes: RelationshipTypeDefinition[] = []
  for (const rt of resolvedRelationships) {
    const sourceId = entityNameToId.get(rt.sourceEntityTypeName)
    const targetId = entityNameToId.get(rt.targetEntityTypeName)
    if (!sourceId || !targetId) continue

    createdRelationshipTypes.push({
      id: crypto.randomUUID(),
      hubId,
      sourceEntityTypeId: sourceId,
      targetEntityTypeId: targetId,
      cardinality: rt.cardinality,
      label: resolveLabel(template.labels, rt.label),
      reverseLabel: resolveLabel(template.labels, rt.reverseLabel),
      sourceLabel: resolveLabel(template.labels, rt.sourceLabel),
      targetLabel: resolveLabel(template.labels, rt.targetLabel),
      roles: rt.roles?.map(r => ({
        ...r,
        label: resolveLabel(template.labels, r.label),
      })),
      defaultRole: rt.defaultRole,
      cascadeDelete: rt.cascadeDelete,
      required: rt.required,
      templateId: template.id,
      isSystem: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }

  return {
    entityTypes: createdEntityTypes,
    relationshipTypes: createdRelationshipTypes,
    appliedRecord: {
      templateId: template.id,
      templateVersion: template.version,
      appliedAt: new Date().toISOString(),
      entityTypeIds: createdEntityTypes.map(e => e.id),
      relationshipTypeIds: createdRelationshipTypes.map(r => r.id),
    },
  }
}

/**
 * Resolve a label string — if it's a key in the labels map, return the localized value.
 * Otherwise, return the string as-is (it's already a literal label).
 */
function resolveLabel(labels: Record<string, Record<string, string>>, key: string): string {
  // Try English first, then return the key itself
  return labels['en']?.[key] ?? key
}

/**
 * Detect available template updates.
 * Compares installed template versions against available versions.
 */
export function detectTemplateUpdates(
  appliedTemplates: AppliedTemplateRecord[],
  availableTemplates: CaseManagementTemplate[],
): Array<{ templateId: string; installedVersion: string; availableVersion: string }> {
  const updates: Array<{ templateId: string; installedVersion: string; availableVersion: string }> = []

  for (const applied of appliedTemplates) {
    const available = availableTemplates.find(t => t.id === applied.templateId)
    if (!available) continue
    if (available.version !== applied.templateVersion) {
      updates.push({
        templateId: applied.templateId,
        installedVersion: applied.templateVersion,
        availableVersion: available.version,
      })
    }
  }

  return updates
}
```

#### Task 5: Template Application API Route

**File**: `apps/worker/routes/entity-schema.ts` (extend)

Add template-related routes:

```typescript
// List available templates
entitySchema.get('/templates',
  requirePermission('settings:read'),
  async (c) => {
    // Templates are bundled with the worker as static imports
    const templates = await loadBundledTemplates()
    return c.json({ templates: templates.map(t => ({
      id: t.id,
      version: t.version,
      name: t.name,
      description: t.description,
      tags: t.tags,
      entityTypeCount: t.entityTypes.length,
      extends: t.extends,
    }))})
  },
)

// Get full template details
entitySchema.get('/templates/:id',
  requirePermission('settings:read'),
  async (c) => {
    const id = c.req.param('id')
    const templates = await loadBundledTemplates()
    const template = templates.find(t => t.id === id)
    if (!template) return c.json({ error: 'Template not found' }, 404)
    return c.json(template)
  },
)

// Apply a template to the hub
entitySchema.post('/templates/apply',
  requirePermission('cases:manage-types'),
  async (c) => {
    const { templateId } = await c.req.json<{ templateId: string }>()
    const dos = getScopedDOs(c.env, c.get('hubId'))

    // Load template
    const templates = await loadBundledTemplates()
    const template = templates.find(t => t.id === templateId)
    if (!template) return c.json({ error: 'Template not found' }, 404)

    // Get existing entity types
    const existingRes = await dos.settings.fetch(new Request('http://do/settings/entity-types'))
    const { entityTypes: existing } = await existingRes.json() as { entityTypes: EntityTypeDefinition[] }

    const existingRelRes = await dos.settings.fetch(new Request('http://do/settings/relationship-types'))
    const { relationshipTypes: existingRels } = await existingRelRes.json() as { relationshipTypes: RelationshipTypeDefinition[] }

    // Apply template
    const allTemplatesMap = new Map(templates.map(t => [t.id, t]))
    const result = await applyTemplate(template, c.get('hubId'), allTemplatesMap, existing, existingRels)

    // Merge with existing (replace matching names, add new)
    const mergedEntityTypes = [...existing]
    for (const newET of result.entityTypes) {
      const idx = mergedEntityTypes.findIndex(e => e.name === newET.name)
      if (idx >= 0) mergedEntityTypes[idx] = newET
      else mergedEntityTypes.push(newET)
    }

    const mergedRelTypes = [...existingRels, ...result.relationshipTypes]

    // Save
    await dos.settings.fetch(new Request('http://do/settings/entity-types', {
      method: 'PUT',
      body: JSON.stringify({ entityTypes: mergedEntityTypes }),
    }))

    await dos.settings.fetch(new Request('http://do/settings/relationship-types', {
      method: 'PUT',
      body: JSON.stringify({ relationshipTypes: mergedRelTypes }),
    }))

    // Track applied template
    const appliedRes = await dos.settings.fetch(new Request('http://do/settings/applied-templates'))
    const { appliedTemplates = [] } = await appliedRes.json() as { appliedTemplates: any[] }
    appliedTemplates.push(result.appliedRecord)
    await dos.settings.fetch(new Request('http://do/settings/applied-templates', {
      method: 'PUT',
      body: JSON.stringify({ appliedTemplates }),
    }))

    // Enable case management if not already
    await dos.settings.fetch(new Request('http://do/settings/case-management', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    }))

    await audit(dos.records, 'templateApplied', c.get('pubkey'), {
      templateId, templateVersion: template.version,
      entityTypesCreated: result.entityTypes.length,
      relationshipTypesCreated: result.relationshipTypes.length,
    })

    return c.json({
      applied: true,
      entityTypes: result.entityTypes.length,
      relationshipTypes: result.relationshipTypes.length,
      suggestedRoles: template.suggestedRoles,
    }, 201)
  },
)

// Check for template updates
entitySchema.get('/templates/updates',
  requirePermission('settings:read'),
  async (c) => {
    const dos = getScopedDOs(c.env, c.get('hubId'))
    const appliedRes = await dos.settings.fetch(new Request('http://do/settings/applied-templates'))
    const { appliedTemplates = [] } = await appliedRes.json() as { appliedTemplates: any[] }
    const available = await loadBundledTemplates()
    const updates = detectTemplateUpdates(appliedTemplates, available)
    return c.json({ updates })
  },
)
```

#### Task 6: Template Loading from Bundle

**File**: `apps/worker/lib/template-loader.ts` (new)

Templates are imported as static JSON at build time:

```typescript
import type { CaseManagementTemplate } from '@protocol/template-types'

// Static imports of all bundled templates
import jailSupport from '@protocol/templates/jail-support.json'
import streetMedic from '@protocol/templates/street-medic.json'
import iceRapidResponse from '@protocol/templates/ice-rapid-response.json'
import bailFund from '@protocol/templates/bail-fund.json'
import dvCrisis from '@protocol/templates/dv-crisis.json'
import antiTrafficking from '@protocol/templates/anti-trafficking.json'
import hateCrimeReporting from '@protocol/templates/hate-crime-reporting.json'
import copwatch from '@protocol/templates/copwatch.json'
import tenantOrganizing from '@protocol/templates/tenant-organizing.json'
import mutualAid from '@protocol/templates/mutual-aid.json'
import missingPersons from '@protocol/templates/missing-persons.json'
import generalHotline from '@protocol/templates/general-hotline.json'
import kyrTraining from '@protocol/templates/kyr-training.json'

const BUNDLED_TEMPLATES: CaseManagementTemplate[] = [
  jailSupport,
  streetMedic,
  iceRapidResponse,
  bailFund,
  dvCrisis,
  antiTrafficking,
  hateCrimeReporting,
  copwatch,
  tenantOrganizing,
  mutualAid,
  missingPersons,
  generalHotline,
  kyrTraining,
] as CaseManagementTemplate[]

export async function loadBundledTemplates(): Promise<CaseManagementTemplate[]> {
  return BUNDLED_TEMPLATES
}
```

#### Task 7: i18n Strings

**File**: `packages/i18n/locales/en.json`

```json
{
  "templates": {
    "title": "Templates",
    "browse": "Browse Templates",
    "apply": "Apply Template",
    "applied": "Template applied successfully",
    "alreadyApplied": "This template is already applied",
    "updatesAvailable": "Template updates available",
    "updateTemplate": "Update Template",
    "noTemplates": "No templates available",
    "entityTypesCreated": "{{count}} entity types created",
    "relationshipTypesCreated": "{{count}} relationship types created",
    "suggestedRoles": "Suggested roles",
    "createSuggestedRoles": "Create suggested roles?",
    "tags": "Tags",
    "version": "Version {{version}}",
    "author": "By {{author}}",
    "composition": "This template extends: {{templates}}"
  }
}
```

#### Task 8: BDD Feature File

**File**: `packages/test-specs/features/core/templates.feature`

```gherkin
@backend
Feature: Case Management Templates
  Admins apply pre-built templates to bootstrap entity types,
  relationship types, and suggested roles for specific use cases.

  Background:
    Given a registered admin "admin1"
    And case management is enabled

  @cases @templates
  Scenario: List available templates
    When admin "admin1" lists available templates
    Then the response should contain at least 13 templates
    And each template should have an id, name, and description

  @cases @templates
  Scenario: Get template details
    When admin "admin1" requests template "jail-support"
    Then the response should include entity types
    And the response should include relationship types
    And the response should include suggested roles

  @cases @templates
  Scenario: Apply jail support template
    When admin "admin1" applies template "jail-support"
    Then the hub should have an entity type "arrest_case"
    And the entity type "arrest_case" should have 18 fields
    And the entity type "arrest_case" should have status "reported"
    And the hub should have an entity type "mass_arrest_event"
    And the hub should have a relationship between "contact" and "arrest_case"
    And case management should be enabled

  @cases @templates
  Scenario: Apply multiple templates (composition)
    When admin "admin1" applies template "jail-support"
    And admin "admin1" applies template "street-medic"
    Then the hub should have entity type "arrest_case"
    And the hub should have entity type "medical_encounter"
    And both should share the contact directory

  @cases @templates
  Scenario: Re-apply template preserves customizations
    Given admin "admin1" has applied template "jail-support"
    And admin "admin1" has added a custom field "custom_note" to "arrest_case"
    When admin "admin1" re-applies template "jail-support"
    Then the entity type "arrest_case" should still have field "custom_note"

  @cases @templates
  Scenario: Detect template updates
    Given admin "admin1" has applied template "jail-support" version "1.0.0"
    When a newer version "1.1.0" is available
    Then the template updates endpoint should report an update for "jail-support"

  @cases @templates @permissions
  Scenario: Volunteer cannot apply templates
    Given a registered volunteer "vol1"
    When volunteer "vol1" tries to apply template "jail-support"
    Then the response status should be 403
```

## Files to Create

| File | Purpose |
|------|---------|
| `packages/protocol/template-types.ts` | Template manifest Zod schema |
| `packages/protocol/templates/*.json` | 13 pre-built template JSON files |
| `packages/protocol/tools/validate-templates.ts` | Build-time template validation |
| `apps/worker/lib/template-engine.ts` | Template application and composition logic |
| `apps/worker/lib/template-loader.ts` | Static import of bundled templates |
| `packages/test-specs/features/core/templates.feature` | BDD scenarios |
| `tests/steps/backend/templates.steps.ts` | Backend step definitions |

## Files to Modify

| File | Change |
|------|--------|
| `apps/worker/routes/entity-schema.ts` | Add template routes (list, get, apply, updates) |
| `apps/worker/durable-objects/settings-do.ts` | Add `appliedTemplates` storage + PUT handler for bulk entity type replacement |
| `packages/i18n/locales/en.json` | Add templates i18n section |
| `packages/i18n/locales/*.json` | Propagate to all 13 locales |
| `package.json` | Add `templates:validate` script |

## Testing

### Template Validation
- `bun run templates:validate` — validates all 13 template JSON files

### Backend BDD
- `bun run test:backend:bdd` — 7 scenarios in `templates.feature`

## Acceptance Criteria & Test Scenarios

- [ ] 13 pre-built templates pass validation
  -> `bun run templates:validate` succeeds
- [ ] Available templates can be listed
  -> `packages/test-specs/features/core/templates.feature: "List available templates"`
- [ ] Template details include entity types, relationships, and suggested roles
  -> `packages/test-specs/features/core/templates.feature: "Get template details"`
- [ ] Applying a template creates entity types and relationships
  -> `packages/test-specs/features/core/templates.feature: "Apply jail support template"`
- [ ] Multiple templates can be applied to the same hub
  -> `packages/test-specs/features/core/templates.feature: "Apply multiple templates"`
- [ ] Re-applying a template preserves admin customizations
  -> `packages/test-specs/features/core/templates.feature: "Re-apply template preserves customizations"`
- [ ] Template update detection works
  -> `packages/test-specs/features/core/templates.feature: "Detect template updates"`
- [ ] Only admins can apply templates
  -> `packages/test-specs/features/core/templates.feature: "Volunteer cannot apply templates"`
- [ ] All platform BDD suites pass (`bun run test:all`)
- [ ] Backlog files updated

## Feature Files

| File | Status | Description |
|------|--------|-------------|
| `packages/test-specs/features/core/templates.feature` | New | 7 scenarios for template operations |
| `tests/steps/backend/templates.steps.ts` | New | Backend step definitions |

## Risk Assessment

- **Low risk**: Template types (Task 1) — Zod schema definition, no runtime impact
- **Medium risk**: Template JSON files (Task 2) — the largest task. Each template needs accurate domain-specific fields. The use case catalog and domain research provide the source data.
- **Low risk**: Validation script (Task 3) — build-time only, catches errors early
- **Medium risk**: Template engine (Task 4) — composition logic and merge semantics need careful testing. Edge cases: conflicting field names across templates, circular extends chains.
- **Low risk**: API routes (Task 5) — standard CRUD pattern

## Execution

- Tasks 1-3 are independent (types, JSON files, validation)
- Task 4 depends on Task 1
- Task 5 depends on Task 4
- Task 6 depends on Task 2
- **Phase 1**: Types → JSON files → Validation → Engine → Routes → i18n → BDD → gate
- **Phase 2**: No desktop UI in this epic (template browser is in Epic 329)
- **Phase 3**: `bun run test:all`
