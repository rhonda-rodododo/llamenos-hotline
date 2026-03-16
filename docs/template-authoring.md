# Template Authoring Guide

Templates define pre-configured case types, fields, statuses, relationships, report types, and suggested roles. They are JSON files in `packages/protocol/templates/`.

## Template Structure

A template is a JSON file with this top-level structure:

```json
{
  "id": "jail-support",
  "version": "1.2.0",
  "name": "Jail Support",
  "description": "Mass arrest intake, arraignment tracking...",
  "author": "Llamenos Project",
  "license": "CC-BY-SA-4.0",
  "tags": ["legal", "protest", "jail-support"],
  "extends": [],
  "labels": { ... },
  "entityTypes": [ ... ],
  "relationshipTypes": [ ... ],
  "reportTypes": [ ... ],
  "suggestedRoles": [ ... ]
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (kebab-case) |
| `version` | string | Semver version string |
| `name` | string | Human-readable template name |
| `description` | string | What the template is for |
| `entityTypes` | array | At least one entity type definition |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `author` | string | Template author |
| `license` | string | License identifier |
| `tags` | string[] | Search/filter tags |
| `extends` | string[] | IDs of parent templates to inherit from |
| `labels` | object | i18n label overrides by locale |
| `relationshipTypes` | array | How entity types relate to each other |
| `reportTypes` | array | Quick-entry report types (mobile-friendly) |
| `suggestedRoles` | array | Roles with pre-configured permissions |

## Entity Type Definition

Each entity type defines a kind of record your hub tracks. From the jail-support template:

```json
{
  "name": "arrest_case",
  "label": "arrest_case.label",
  "labelPlural": "arrest_case.labelPlural",
  "description": "arrest_case.description",
  "icon": "handcuffs",
  "color": "#ef4444",
  "category": "case",
  "numberPrefix": "JS",
  "numberingEnabled": true,
  "defaultAccessLevel": "assigned",
  "piiFields": ["attorney_name", "attorney_phone"],
  "allowSubRecords": false,
  "allowFileAttachments": true,
  "allowInteractionLinks": true,
  "showInNavigation": true,
  "showInDashboard": true,
  "statuses": [ ... ],
  "defaultStatus": "reported",
  "closedStatuses": ["case_closed"],
  "severities": [ ... ],
  "defaultSeverity": "standard",
  "contactRoles": [ ... ],
  "fields": [ ... ]
}
```

### Entity Type Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | yes | Machine-readable identifier (snake_case, immutable) |
| `label` | string | yes | Display name or label key (see Labels/i18n) |
| `labelPlural` | string | yes | Plural display name |
| `description` | string | no | What this entity type tracks |
| `icon` | string | no | Icon name (lucide icon set) |
| `color` | string | no | Hex color for UI accent |
| `category` | enum | yes | `case`, `event`, `contact`, `resource`, or `task` |
| `numberPrefix` | string | no | Prefix for auto-generated case numbers (e.g., "JS") |
| `numberingEnabled` | boolean | no | Whether to auto-generate case numbers |
| `defaultAccessLevel` | enum | no | Default field access: `all`, `assigned`, `hub`, `admin` |
| `piiFields` | string[] | no | Field names that contain PII (encrypted at admin tier) |
| `statuses` | EnumOption[] | yes | Ordered status definitions |
| `defaultStatus` | string | yes | Status value assigned to new records |
| `closedStatuses` | string[] | yes | Status values that mark records as closed |
| `severities` | EnumOption[] | no | Optional priority levels |
| `defaultSeverity` | string | no | Default severity for new records |
| `contactRoles` | EnumOption[] | no | How contacts relate to records of this type |
| `fields` | FieldDefinition[] | yes | Data fields for this entity type |

### EnumOption (Statuses, Severities, Contact Roles)

```json
{
  "value": "in_custody",
  "label": "In Custody",
  "color": "#ef4444",
  "icon": "alert-triangle",
  "order": 3,
  "isClosed": false
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `value` | string | yes | Machine-readable value (snake_case) |
| `label` | string | yes | Display text |
| `color` | string | no | Hex color |
| `icon` | string | no | Icon name |
| `order` | number | yes | Sort order |
| `isClosed` | boolean | no | For statuses only: marks as closed/resolved |

## Field Definitions

Fields define what data is collected for each record.

```json
{
  "name": "arrest_location",
  "label": "Arrest Location",
  "type": "text",
  "required": true,
  "section": "arrest_details",
  "helpText": "Intersection or landmark where the arrest occurred.",
  "order": 2,
  "indexable": false,
  "accessLevel": "all"
}
```

### Field Types

| Type | Description | Extra Properties |
|------|-------------|------------------|
| `text` | Single-line text input | `placeholder`, `validation.minLength`, `validation.maxLength`, `validation.pattern` |
| `textarea` | Multi-line text area | `placeholder`, `supportAudioInput` |
| `number` | Numeric input | `validation.min`, `validation.max` |
| `select` | Single-select dropdown | `options[]` |
| `multiselect` | Multi-select checkboxes | `options[]` |
| `checkbox` | Boolean toggle | -- |
| `date` | Date/time picker | -- |
| `file` | File upload trigger | -- |

### Field Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | yes | Machine-readable key (snake_case) |
| `label` | string | yes | Display label |
| `type` | enum | yes | One of the field types above |
| `required` | boolean | no | Whether the field must be filled (default: false) |
| `section` | string | no | Groups fields into collapsible sections |
| `helpText` | string | no | Hint text shown below the label |
| `placeholder` | string | no | Placeholder text for empty fields |
| `order` | number | yes | Sort order within the entity type |
| `accessLevel` | enum | yes | `all`, `assigned`, or `admin` |
| `indexable` | boolean | no | Whether blind-index search is enabled |
| `indexType` | enum | no | `exact` or `none` (default: `none`) |
| `hubEditable` | boolean | no | Whether hub operators can customize this field |
| `options` | Option[] | for select/multiselect | `[{ "key": "felony", "label": "Felony" }]` |
| `validation` | object | no | Validation rules (see below) |
| `showWhen` | object | no | Conditional visibility rule |
| `supportAudioInput` | boolean | no | Enable speech-to-text for this field (mobile) |

### Validation Rules

```json
{
  "validation": {
    "min": 0,
    "max": 1000000,
    "minLength": 1,
    "maxLength": 5000,
    "pattern": "^[A-Z0-9-]+$"
  }
}
```

All validation properties are optional. They map to HTML input attributes on the client.

### Conditional Visibility (showWhen)

Fields can be shown/hidden based on another field's value:

```json
{
  "name": "bail_posted_date",
  "label": "Bail Posted Date",
  "type": "date",
  "showWhen": {
    "field": "bail_status",
    "operator": "equals",
    "value": "posted"
  }
}
```

Operators:
- `equals`: Show when the dependent field equals the value
- `not_equals`: Show when the dependent field does not equal the value
- `contains`: Show when the dependent field (string or array) contains the value
- `is_set`: Show when the dependent field has any truthy value

### Access Levels and PII Fields

Fields are encrypted at three tiers:

1. **`all`** (Summary tier): Visible to anyone with `cases:read-*`. Used for timestamps, statuses, non-sensitive metadata.
2. **`assigned`** (Fields tier): Visible to assigned volunteers and admins. Used for case details, charges, bail.
3. **`admin`** (PII tier): Visible to admins only. Used for attorney contacts, immigration status, identity info.

The `piiFields` array at the entity type level explicitly lists field names that contain PII, providing an additional layer of documentation and validation.

## Report Type Definition

Report types define quick-entry forms for field workers (legal observers, medics). From the jail-support template:

```json
{
  "name": "lo_arrest_report",
  "label": "lo_arrest_report.label",
  "labelPlural": "lo_arrest_report.labelPlural",
  "description": "lo_arrest_report.description",
  "icon": "clipboard-list",
  "color": "#ef4444",
  "allowFileAttachments": true,
  "allowCaseConversion": true,
  "mobileOptimized": true,
  "numberPrefix": "AR",
  "numberingEnabled": true,
  "statuses": [ ... ],
  "defaultStatus": "submitted",
  "closedStatuses": ["closed"],
  "fields": [ ... ]
}
```

### Report Type Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Machine-readable identifier |
| `label` | string | Display name (or label key) |
| `description` | string | What this report type captures |
| `icon` | string | Icon name |
| `color` | string | Hex color |
| `allowFileAttachments` | boolean | Whether photos/files can be attached |
| `allowCaseConversion` | boolean | Whether reports can be promoted to full cases |
| `mobileOptimized` | boolean | Whether the form is designed for mobile input |
| `supportAudioInput` | boolean | Whether any field supports speech-to-text |
| `numberPrefix` | string | Auto-numbering prefix |
| `numberingEnabled` | boolean | Enable auto-numbering |
| `statuses` | EnumOption[] | Report lifecycle statuses |
| `fields` | FieldDefinition[] | Same field definition format as entity types |

Fields in report types support `supportAudioInput: true` to enable speech-to-text on mobile, useful for legal observers in the field who cannot type.

## Labels / i18n in Templates

Templates can define labels in multiple locales using the `labels` object. When a field's `label`, `labelPlural`, or `description` value matches a key in the labels object, the template engine resolves it to the current locale.

```json
{
  "labels": {
    "en": {
      "arrest_case.label": "Arrest Case",
      "arrest_case.labelPlural": "Arrest Cases",
      "arrest_case.description": "Track an individual through the arrest process"
    },
    "es": {
      "arrest_case.label": "Caso de Arresto",
      "arrest_case.labelPlural": "Casos de Arresto",
      "arrest_case.description": "Seguimiento de una persona a traves del proceso de arresto"
    }
  }
}
```

In entity type and report type definitions, use the label key as the value:

```json
{
  "name": "arrest_case",
  "label": "arrest_case.label",
  "labelPlural": "arrest_case.labelPlural"
}
```

The template engine resolves these at apply time based on the hub's locale.

## Template Versioning and Extends

### Versioning

Use semver (`MAJOR.MINOR.PATCH`):
- **PATCH**: Bug fixes, label corrections
- **MINOR**: New fields, new statuses, new report types (backward-compatible)
- **MAJOR**: Renamed/removed fields, restructured entity types (breaking)

The system tracks which version was applied per hub. Admins see "Update Available" when a newer version exists.

### Extends (Template Inheritance)

Templates can inherit from other templates:

```json
{
  "id": "jail-support-immigration",
  "extends": ["jail-support"],
  "entityTypes": [
    {
      "name": "immigration_case",
      "label": "Immigration Case",
      ...
    }
  ]
}
```

The `extends` array lists parent template IDs. When applied, entity types from parent templates are included first, then the child template's types are merged (matching by `name`, adding new ones).

## Suggested Roles

Templates can suggest roles with pre-configured permissions:

```json
{
  "suggestedRoles": [
    {
      "name": "Hotline Coordinator",
      "slug": "hotline-coordinator",
      "description": "Manages the hotline during actions",
      "permissions": ["cases:*", "contacts:*", "calls:*", "notes:*"]
    },
    {
      "name": "Intake Volunteer",
      "slug": "intake-volunteer",
      "description": "Takes arrest reports from incoming calls",
      "permissions": ["cases:create", "cases:read-own", "cases:update-own"]
    }
  ]
}
```

Roles are not created automatically on template apply. Instead, the UI presents them to the admin who can choose which to create. Duplicate slugs are skipped.

## File Location

Template files live at `packages/protocol/templates/<template-id>.json`. They are loaded by the backend via `loadBundledTemplates()` and served through the `GET /api/settings/cms/templates` endpoint.

To add a new template:
1. Create a JSON file in `packages/protocol/templates/`.
2. Follow the structure above.
3. The template will be available in the Template Browser the next time the worker is deployed.
