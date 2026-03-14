# Case Management System — Data Model Reference

**Date**: 2026-03-14
**Status**: DRAFT — evolving as research completes
**Purpose**: Canonical reference for the CMS entity model, encryption strategy, storage architecture, and cross-entity relationships. All epics derive their schemas from this document.

---

## Design Principles

1. **Cases are optional.** The hotline works without case management enabled. When enabled, cases layer on top of existing notes, conversations, and reports.
2. **Contacts are real people.** A Contact is a person — not a phone number. One person may have multiple identifiers (phones, Signal accounts, nicknames). The system must handle this.
3. **Everything is E2EE.** All PII, case content, and evidence is encrypted at rest. The server sees only blind indexes, cleartext metadata (timestamps, status enums), and encrypted blobs.
4. **Templates define the entity schema.** Entity types, relationships, custom fields, status enumerations, and roles are all admin-configurable via JSON templates. Templates bootstrap common configurations (NLG Legal Observer, Jail Support, Street Medic, etc.). Admins can customize any template or build from scratch — SugarCRM-level flexibility.
5. **Hub-scoped by default.** Each hub maintains its own contact directory, entity records, and schema. Cross-hub visibility is opt-in.
6. **Envelope-based access control.** Who gets a decryption envelope IS the access control. The server never decides who can read what.
7. **Schema-driven UI.** The client renders forms, lists, and detail views dynamically from entity type definitions. No compile-time knowledge of specific fields is required. The UI is a generic entity viewer/editor driven by the schema.

---

## Architecture: Template-Driven Entity System

### Inspiration: SugarCRM's Flexibility

SugarCRM allows creating arbitrary "modules" (entity types) with custom fields and
relationships. Llamenos achieves similar flexibility with E2EE constraints:

- **Entity Type Definitions** replace SugarCRM's "modules" — JSON-defined schemas with
  fields, statuses, relationships, and access control
- **Relationship Type Definitions** define how entity types connect — M:N with role metadata
- **Templates** are bundles of entity types + relationships + i18n labels
- **The storage layer is schemaless** (DO key-value store) — adding entity types doesn't
  require schema migrations
- **The encryption layer is entity-agnostic** — ECIES envelopes work per-record regardless of type
- **The UI is schema-driven** — forms/lists rendered from field definitions at runtime

### Three Levels of Flexibility

**Level 1: Template-applied configuration** (ships day 1)
- Admin picks a template (e.g., "Jail Support") during hub setup
- Template creates entity types, relationship types, roles, and default enumerations
- Everything works out of the box

**Level 2: Template customization** (ships day 1)
- Admin adds/removes/reorders fields on any entity type
- Admin customizes enumeration values (add statuses, rename severities)
- Admin modifies relationship metadata (change role labels)
- Admin creates new entity types from scratch (like SugarCRM custom modules)

**Level 3: Full schema design** (stretch — same engine, more UI)
- Admin designs entity types with full relationship graphs
- Admin creates custom list/detail views
- Admin defines computed fields, validation rules, conditional logic
- This is the full SugarCRM Studio equivalent

---

## Entity Relationship Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Hub (scope boundary)                         │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │              Schema Layer (JSON, cleartext config)                │ │
│  │  EntityTypeDefinition[]  ←→  RelationshipTypeDefinition[]       │ │
│  │  EnumDefinition[]        ←→  Template[]                          │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │              Data Layer (E2EE, per-record envelopes)             │ │
│  │                                                                    │ │
│  │  ┌──────────┐    M:N     ┌──────────┐    M:N     ┌──────────┐ │ │
│  │  │ Contact  │◄──────────►│  Record  │◄──────────►│  Event   │ │ │
│  │  │          │  RecordRole│ (any     │  RecordEvt │          │ │ │
│  │  └────┬─────┘            │  entity  │            └──────────┘ │ │
│  │       │                  │  type)   │                           │ │
│  │       │ M:N              └────┬─────┘                           │ │
│  │       ▼                       │ 1:N                              │ │
│  │  ┌──────────┐          ┌────────────┐                           │ │
│  │  │ Contact  │          │ Interaction│ (note, call, message,     │ │
│  │  │ Relation │          │            │  status change, referral) │ │
│  │  │ ship     │          └────────────┘                           │ │
│  │  └──────────┘                                                    │ │
│  │                                                                    │ │
│  │  ┌──────────┐    M:N     ┌──────────┐                           │ │
│  │  │  Report  │◄──────────►│  Record  │                           │ │
│  │  │(existing)│  ReportLink│          │                           │
│  └──────────┘            └──────────┘                           │
│                                                                  │
│  ┌──────────┐                                                    │
│  │ Affinity │ (named group of contacts with roles)              │
│  │  Group   │                                                    │
│  └──────────┘                                                    │
└────────────────────────────────────────────────────────────────┘
```

---

## Schema Definitions (The Template Engine)

These types define the schema layer — they are cleartext JSON configuration stored in
SettingsDO. They tell the system what entity types exist, what fields they have, and how
they relate to each other.

### EntityTypeDefinition

Generalizes `CaseType` and `ReportType` into a universal entity type definition.
This is the equivalent of a SugarCRM "module definition."

```typescript
interface EntityTypeDefinition {
  id: string                        // UUID
  hubId: string

  // --- Identity ---
  name: string                      // Machine name: "arrest_case", "medical_encounter"
  label: string                     // Display: "Arrest Case", "Medical Encounter"
  labelPlural: string               // Display: "Arrest Cases", "Medical Encounters"
  description: string
  icon?: string                     // Lucide icon name
  color?: string                    // Theme color (hex)

  // --- Category ---
  // Built-in categories define base behavior (storage, encryption, indexing).
  // "custom" inherits the generic Record behavior.
  category: 'contact' | 'case' | 'event' | 'custom'

  // --- Template source ---
  templateId?: string               // Which template created this type
  templateVersion?: string          // Version of the template at import time

  // --- Field schema ---
  fields: EntityFieldDefinition[]   // Extends CustomFieldDefinition

  // --- Status workflow ---
  statuses: EnumDefinition[]        // Ordered status enumeration
  defaultStatus: string             // Applied to new records
  closedStatuses: string[]          // Which statuses count as "closed/resolved"

  // --- Severity / priority ---
  severities?: EnumDefinition[]
  defaultSeverity?: string

  // --- Categories / subcategories ---
  categories?: EnumDefinition[]

  // --- Contact roles (for case-type entities) ---
  contactRoles?: EnumDefinition[]   // e.g., 'client', 'attorney', 'witness'

  // --- Record numbering ---
  numberPrefix?: string             // e.g., "JS" → "JS-2026-0042"
  numberingEnabled: boolean

  // --- Access control ---
  defaultAccessLevel: 'assigned' | 'team' | 'hub'  // Who gets envelopes by default
  piiFields: string[]               // Field names that contain PII (extra envelope restrictions)

  // --- Behavior flags ---
  allowSubRecords: boolean          // Can have parent/child hierarchy?
  allowFileAttachments: boolean
  allowInteractionLinks: boolean    // Can link to notes/calls/conversations?
  showInNavigation: boolean         // Show in main nav sidebar?
  showInDashboard: boolean          // Show counts/recent on dashboard?

  // --- Metadata ---
  isArchived: boolean
  isSystem: boolean                 // Built-in type (cannot be deleted)
  createdAt: string
  updatedAt: string
}
```

### EntityFieldDefinition

Extends the existing `CustomFieldDefinition` with additional capabilities for the
entity schema system.

```typescript
interface EntityFieldDefinition extends CustomFieldDefinition {
  // --- Inherited from CustomFieldDefinition ---
  // id, name, label, type, required, options, validation,
  // visibleToVolunteers, editableByVolunteers, order, createdAt

  // --- Extended capabilities ---
  section?: string                  // Group fields into sections (like SugarCRM panels)
  helpText?: string                 // Tooltip/help text for the field
  placeholder?: string              // Input placeholder text
  defaultValue?: string | number | boolean

  // --- Blind index configuration ---
  indexable: boolean                // Generate blind index for server-side filtering?
  indexType: 'exact' | 'none'       // 'exact' = HMAC blind index

  // --- Access control ---
  accessLevel: 'all' | 'admin' | 'assigned' | 'custom'
  // 'all' = everyone with record access can see this field
  // 'admin' = only admins get envelope for this field
  // 'assigned' = assigned volunteers + admins
  // 'custom' = specific role IDs (defined in accessRoles)
  accessRoles?: string[]            // Role IDs that can see this field

  // --- Conditional visibility ---
  showWhen?: {
    field: string                   // Name of another field
    operator: 'equals' | 'not_equals' | 'contains' | 'is_set'
    value?: string | number | boolean
  }

  // --- Relationship field ---
  // For fields that reference other entity types (like a "Related Case" dropdown)
  referencedEntityType?: string     // Entity type ID this field links to
  referenceDisplayField?: string    // Which field of the referenced entity to show
}
```

### RelationshipTypeDefinition

Defines how two entity types can be connected. This is the equivalent of
SugarCRM's relationship definitions.

```typescript
interface RelationshipTypeDefinition {
  id: string
  hubId: string

  // --- Endpoints ---
  sourceEntityTypeId: string        // e.g., "contact"
  targetEntityTypeId: string        // e.g., "arrest_case"

  // --- Cardinality ---
  cardinality: '1:1' | '1:N' | 'M:N'

  // --- Labels ---
  label: string                     // "Contact Cases"
  reverseLabel: string              // "Case Contacts"
  sourceLabel: string               // "is client of"
  targetLabel: string               // "has client"

  // --- Role metadata on the join ---
  roles?: EnumDefinition[]          // e.g., 'client', 'attorney', 'witness'
  defaultRole?: string

  // --- Join metadata fields ---
  joinFields?: EntityFieldDefinition[]  // Extra fields on the relationship itself
                                        // e.g., "Start Date", "End Date", "Notes"

  // --- Behavior ---
  cascadeDelete: boolean            // Delete relationships when source/target deleted?
  required: boolean                 // Must every record of source type have this relationship?

  // --- Template source ---
  templateId?: string
  isSystem: boolean                 // Built-in (contact↔case is always present)

  createdAt: string
  updatedAt: string
}
```

### EnumDefinition

Reusable enumeration definition for statuses, severities, categories, roles.

```typescript
interface EnumDefinition {
  value: string                     // Machine value: "in_custody", "released"
  label: string                     // Display: "In Custody", "Released"
  color?: string                    // UI color hint: "#ef4444" (red)
  icon?: string                     // Lucide icon name
  order: number                     // Sort position
  isDefault?: boolean               // Pre-selected in forms?
  isClosed?: boolean                // Does this status count as "closed"?
}
```

### CaseManagementTemplate

The template package format. Ships as JSON in `packages/protocol/templates/`.

```typescript
interface CaseManagementTemplate {
  // --- Identity ---
  id: string                        // e.g., "nlg-legal-observer"
  version: string                   // Semver: "1.0.0"
  name: string                      // "NLG Legal Observer"
  description: string
  author: string                    // "Llamenos Project"
  license: string                   // "CC-BY-SA-4.0"
  tags: string[]                    // ["legal", "protest", "jail-support"]

  // --- i18n labels ---
  // All user-facing strings are i18n keys. The labels map provides translations.
  labels: Record<string, Record<string, string>>
  // { "en": { "arrest_case.label": "Arrest Case", ... }, "es": { ... } }

  // --- Schema definitions ---
  entityTypes: Omit<EntityTypeDefinition, 'id' | 'hubId' | 'createdAt' | 'updatedAt'>[]
  relationshipTypes: Omit<RelationshipTypeDefinition, 'id' | 'hubId' | 'createdAt' | 'updatedAt'>[]

  // --- Suggested roles (optional) ---
  suggestedRoles?: {
    name: string
    slug: string
    description: string
    permissions: string[]           // From PERMISSION_CATALOG + new CMS permissions
  }[]

  // --- Composability ---
  extends?: string[]                // Template IDs this extends (inherits their types)

  // --- Report types (optional — if this template also defines report types) ---
  reportTypes?: Omit<import('@shared/types').ReportType, 'id' | 'createdAt' | 'updatedAt'>[]

  // --- Event types (convenience — these are just entity types with category: 'event') ---
  // Already included in entityTypes, but listed separately for clarity in templates
}
```

### How Templates Are Applied

```
1. Admin enables case management → hub setting `caseManagementEnabled: true`
2. Admin picks template(s) from catalog
3. For each template:
   a. Create EntityTypeDefinition records in SettingsDO (with templateId + version)
   b. Create RelationshipTypeDefinition records
   c. Optionally create suggested Role records
   d. Merge i18n labels into hub's locale overrides
4. Admin customizes: add/remove fields, change enum values, tweak labels
5. All customizations are persisted — template source is tracked but doesn't constrain

Template updates:
6. When app ships with a new template version, admin sees "Update available"
7. Three-way merge: old template + new template + current config
8. Admin previews changes and approves/rejects each
```

---

## Core Entities

### 1. Contact

A Contact represents a real person known to the hub. Contacts are identified by blind indexes (HMAC hashes) of their identifiers and have E2EE encrypted profiles.

```typescript
interface Contact {
  id: string                        // UUID
  hubId: string                     // hub scope

  // --- Blind indexes (server-readable for lookup) ---
  identifierHashes: string[]        // HMAC(hubKey, identifier) for each identifier
  nameHash?: string                 // HMAC(hubKey, normalizedName) for dedup/search

  // --- E2EE encrypted profile ---
  encryptedProfile: string          // XChaCha20-Poly1305 encrypted ContactProfile
  profileEnvelopes: RecipientEnvelope[]  // ECIES-wrapped profile key per reader

  // --- Cleartext metadata (server-filterable) ---
  contactType: string               // blind index of type (e.g., 'caller', 'arrestee')
  tags: string[]                    // blind indexes of tag values
  status: string                    // blind index: 'active', 'inactive', 'deceased'
  createdAt: string
  updatedAt: string
  lastInteractionAt: string

  // --- Aggregated counts (server-maintained) ---
  caseCount: number
  noteCount: number
  interactionCount: number
}

// Encrypted payload (client-side only)
interface ContactProfile {
  displayName: string               // Primary name or nickname
  legalName?: string                // Full legal name (if known)
  aliases: string[]                 // Other names, nicknames
  identifiers: ContactIdentifier[]  // Phone numbers, Signal usernames, etc.
  demographics?: {
    pronouns?: string
    language?: string               // Preferred language code
    age?: number
    race?: string                   // Self-identified
    gender?: string                 // Self-identified
    nationality?: string
  }
  emergencyContacts?: {
    name: string
    relationship: string
    identifiers: ContactIdentifier[]
  }[]
  notes?: string                    // Free-text notes about the person
  communicationPreferences?: {
    preferredChannel: 'signal' | 'sms' | 'whatsapp' | 'phone' | 'email'
    preferredLanguage: string
    doNotContact?: boolean
    contactWindow?: string          // e.g., "weekdays 9-5"
  }
}

interface ContactIdentifier {
  type: 'phone' | 'signal' | 'email' | 'nickname' | 'legal_name' | 'custom'
  value: string                     // The actual identifier
  label?: string                    // e.g., "Cell", "Work", "Jail Phone"
  isPrimary: boolean
  verifiedAt?: string               // When this identifier was verified
}
```

**Crypto labels needed:**
- `LABEL_CONTACT_PROFILE` = `"llamenos:contact-profile"` — profile encryption
- `HMAC_CONTACT_ID` = `"llamenos:contact-identifier"` (already exists as `LABEL_CONTACT_ID`)
- `HMAC_CONTACT_NAME` = `"llamenos:contact-name"` — name blind index
- `HMAC_CONTACT_TAG` = `"llamenos:contact-tag"` — tag blind index

**Storage**: `ContactDirectoryDO` (per-hub instance)
- `contact:{id}` → Contact record
- `idx:id:{identifierHash}` → contactId (reverse lookup)
- `idx:name:{nameHash}` → contactId (reverse lookup)
- `idx:tag:{tagHash}:{contactId}` → true (tag index)

---

### 2. Case

A Case is a tracked situation involving one or more contacts. Cases have admin-configurable types, statuses, and custom fields.

```typescript
interface Case {
  id: string                        // UUID
  hubId: string
  caseNumber: string                // Human-readable (e.g., "JS-2026-0042")

  // --- Case type (defines field schema) ---
  caseTypeId: string                // References CaseType definition

  // --- Cleartext metadata (server-filterable via blind indexes) ---
  statusHash: string                // HMAC(hubKey, status) — e.g., hash of "open"
  severityHash: string              // HMAC(hubKey, severity) — e.g., hash of "red"
  categoryHash?: string             // HMAC(hubKey, category)
  assignedTo: string[]              // Pubkeys of assigned volunteers

  // --- E2EE encrypted content ---
  encryptedSummary: string          // XChaCha20-Poly1305 encrypted CaseSummary
  summaryEnvelopes: RecipientEnvelope[]  // Per-reader key wrapping

  // --- E2EE encrypted custom fields ---
  encryptedFields?: string          // XChaCha20-Poly1305 encrypted Record<string, any>
  fieldEnvelopes?: RecipientEnvelope[]

  // --- Relationships ---
  eventIds: string[]                // Linked events
  parentCaseId?: string             // For sub-cases

  // --- Timestamps ---
  createdAt: string
  updatedAt: string
  closedAt?: string

  // --- Counts ---
  contactCount: number
  interactionCount: number
  fileCount: number
}

// Encrypted payload (client-side only)
interface CaseSummary {
  title: string
  description: string
  status: string                    // Cleartext status (client knows the value)
  severity: string                  // Cleartext severity
  category?: string
  outcome?: string
  closureNotes?: string
}

// Encrypted custom field values
interface CaseFieldValues {
  [fieldName: string]: string | number | boolean | string[]
}
```

**Case-Contact join (many-to-many with role):**

```typescript
interface CaseContact {
  caseId: string
  contactId: string
  role: string                      // 'client' | 'representative' | 'attorney' | etc.
  encryptedNotes?: string           // Per-relationship notes (encrypted)
  addedAt: string
  addedBy: string                   // Pubkey of who added this contact
}
```

**Crypto labels needed:**
- `LABEL_CASE_SUMMARY` = `"llamenos:case-summary"` — case summary encryption
- `LABEL_CASE_FIELDS` = `"llamenos:case-fields"` — custom field values encryption
- `HMAC_CASE_STATUS` = `"llamenos:case-status"` — status blind index
- `HMAC_CASE_SEVERITY` = `"llamenos:case-severity"` — severity blind index
- `HMAC_CASE_CATEGORY` = `"llamenos:case-category"` — category blind index

**Storage**: `CaseDO` (per-hub instance)
- `case:{id}` → Case record
- `casecontact:{caseId}:{contactId}` → CaseContact
- `contactcases:{contactId}:{caseId}` → CaseContact (reverse index)
- `idx:status:{statusHash}:{caseId}` → true
- `idx:severity:{severityHash}:{caseId}` → true
- `idx:assigned:{pubkey}:{caseId}` → true
- `idx:event:{eventId}:{caseId}` → true
- `idx:number:{caseNumber}` → caseId

---

### 3. Event

An Event represents a time-bounded occurrence at a location — a protest, ICE raid, mass arrest, disaster, etc. Events group related cases and reports.

```typescript
interface Event {
  id: string                        // UUID
  hubId: string

  // --- Cleartext metadata (server-filterable) ---
  eventTypeHash: string             // Blind index of event type
  statusHash: string                // Blind index: 'upcoming', 'active', 'completed'
  startDate: string                 // ISO 8601 — cleartext for date range queries
  endDate?: string                  // ISO 8601
  parentEventId?: string            // For sub-events (Day 1, Day 2 of multi-day)

  // --- E2EE encrypted details ---
  encryptedDetails: string          // XChaCha20-Poly1305 encrypted EventDetails
  detailEnvelopes: RecipientEnvelope[]

  // --- Cleartext location (OPTIONAL — security-sensitive) ---
  // CRITICAL: GPS precision is a surveillance risk for enforcement-related events.
  // Exact coordinates of ICE sighting locations could reveal safe houses.
  // Exact protest arrest coordinates could be used for subsequent targeting.
  //
  // Configurable precision levels (per hub setting):
  // - 'none': no cleartext location (fully encrypted in EventDetails)
  // - 'city': city-level only (e.g., "Portland, OR")
  // - 'neighborhood': ~1km precision (e.g., "Downtown Portland")
  // - 'block': ~100m precision (snapped to nearest intersection)
  // - 'exact': full coordinates (only for non-sensitive uses like disaster response)
  //
  // Default: 'neighborhood' for protest/enforcement, 'exact' for disaster response
  locationPrecision: 'none' | 'city' | 'neighborhood' | 'block' | 'exact'
  locationApproximate?: string      // e.g., "Downtown Portland" (cleartext, filterable)

  // --- Counts ---
  caseCount: number
  reportCount: number

  createdAt: string
  updatedAt: string
}

// Encrypted payload (client-side only)
interface EventDetails {
  name: string                      // "March for Justice 2026"
  description: string
  eventType: string                 // "protest", "ice_raid", "mass_arrest", etc.
  status: string                    // "upcoming", "active", "completed", "cancelled"

  // Location details (encrypted)
  location?: {
    name: string                    // "Federal Courthouse, 1000 SW 3rd Ave"
    coordinates?: { lat: number; lng: number }
    area?: string                   // "Downtown Portland"
    jurisdiction?: string           // "Multnomah County"
  }

  // Event-specific metadata
  organizers?: string[]
  expectedAttendance?: number
  policePresence?: string
  legalHotlineNumber?: string
  medicalTeamPresent?: boolean

  // Sub-event tracking
  subEventLabels?: string[]         // ["Day 1: March", "Day 2: Rally", "Day 3: Vigil"]

  notes?: string
}
```

**Case-Event join (many-to-many):**

```typescript
interface CaseEvent {
  caseId: string
  eventId: string
  linkedAt: string
  linkedBy: string                  // Pubkey
}
```

**Report-Event join (many-to-many):**

```typescript
interface ReportEvent {
  reportId: string                  // Conversation ID of the report
  eventId: string
  linkedAt: string
  linkedBy: string
}
```

**Crypto labels needed:**
- `LABEL_EVENT_DETAILS` = `"llamenos:event-details"` — event detail encryption
- `HMAC_EVENT_TYPE` = `"llamenos:event-type"` — event type blind index
- `HMAC_EVENT_STATUS` = `"llamenos:event-status"` — event status blind index

**Storage**: Extends `CaseDO` (same DO, separate key prefix)
- `event:{id}` → Event record
- `caseevent:{caseId}:{eventId}` → CaseEvent
- `eventcases:{eventId}:{caseId}` → CaseEvent (reverse)
- `reportevent:{reportId}:{eventId}` → ReportEvent
- `eventreports:{eventId}:{reportId}` → ReportEvent (reverse)
- `idx:eventtype:{typeHash}:{eventId}` → true
- `idx:eventstatus:{statusHash}:{eventId}` → true

---

### 4. Interaction

An Interaction is any activity logged against a case — notes, calls, status changes, referrals. This generalizes the existing Note model to work with cases.

```typescript
interface CaseInteraction {
  id: string                        // UUID
  caseId: string

  // --- Interaction source (links to existing entities) ---
  interactionType: 'note' | 'call' | 'message' | 'status_change' |
                   'referral' | 'assessment' | 'file_upload' | 'comment'
  sourceId?: string                 // ID of the source entity (note ID, call ID, etc.)

  // --- E2EE content ---
  encryptedContent?: string         // For new interactions created directly on cases
  contentEnvelopes?: RecipientEnvelope[]

  // --- Cleartext metadata ---
  authorPubkey: string
  interactionTypeHash: string       // Blind index for filtering
  createdAt: string

  // --- For status changes ---
  previousStatusHash?: string
  newStatusHash?: string
}
```

**Key design decision**: Interactions can be:
1. **Linked**: Reference an existing note/call/conversation by `sourceId`. The actual content is in the original entity.
2. **Inline**: Have their own `encryptedContent` for interactions created directly within the case timeline (e.g., a quick status update comment).

This avoids duplicating data — a note linked to a case is stored once in RecordsDO and referenced from CaseDO.

**Storage**: Part of `CaseDO`
- `interaction:{caseId}:{id}` → CaseInteraction
- `idx:interaction:type:{typeHash}:{caseId}:{id}` → true

---

### 5. Contact Relationship

Tracks relationships between contacts — support networks, attorney-client, family, affinity group membership.

```typescript
interface ContactRelationship {
  id: string
  hubId: string
  contactIdA: string
  contactIdB: string
  relationshipType: string          // 'support_contact', 'attorney', 'family',
                                    // 'affinity_group_member', 'interpreter', 'social_worker'
  // Direction matters for some types:
  // "A is attorney FOR B" — contactIdA is the attorney, contactIdB is the client
  direction: 'a_to_b' | 'b_to_a' | 'bidirectional'

  encryptedNotes?: string           // Relationship-specific notes
  notesEnvelopes?: RecipientEnvelope[]

  createdAt: string
  createdBy: string
}
```

**Storage**: Part of `ContactDirectoryDO`
- `rel:{contactIdA}:{id}` → ContactRelationship
- `relrev:{contactIdB}:{id}` → ContactRelationship (reverse index)

---

### 6. Affinity Group

A named group of contacts, typically a small collective that operates together during actions.

```typescript
interface AffinityGroup {
  id: string
  hubId: string

  // --- E2EE ---
  encryptedDetails: string          // AffinityGroupDetails
  detailEnvelopes: RecipientEnvelope[]

  // --- Cleartext ---
  memberCount: number
  createdAt: string
  updatedAt: string
}

interface AffinityGroupDetails {
  name: string                      // "Pine Street Collective"
  description?: string
  members: AffinityGroupMember[]
}

interface AffinityGroupMember {
  contactId: string
  role?: string                     // 'medic', 'legal_observer', 'de-escalator', 'media'
  isPrimary: boolean                // Primary contact for the group
}
```

**Storage**: Part of `ContactDirectoryDO`
- `group:{id}` → AffinityGroup
- `groupmember:{groupId}:{contactId}` → { role, isPrimary }
- `contactgroups:{contactId}:{groupId}` → true (reverse index)

---

### 7. Case Type (Configuration)

Admin-configurable case type definitions. These define what fields, statuses, and severities are available for cases of each type.

```typescript
interface CaseType {
  id: string                        // UUID
  hubId: string
  templateId?: string               // If created from a template, reference it

  name: string                      // "Jail Support", "Legal Case", "Medical Encounter"
  description: string
  icon?: string                     // Lucide icon name
  color?: string                    // Theme color for UI

  // --- Status enumeration ---
  statuses: EnumOption[]            // Ordered list of possible statuses
  defaultStatus: string             // Status applied to new cases
  closedStatuses: string[]          // Which statuses count as "closed"

  // --- Severity enumeration ---
  severities: EnumOption[]          // Ordered list of severities
  defaultSeverity: string

  // --- Category enumeration ---
  categories?: EnumOption[]

  // --- Custom fields ---
  fields: CustomFieldDefinition[]   // Reuses existing CustomFieldDefinition type

  // --- Contact roles specific to this case type ---
  contactRoles: EnumOption[]        // e.g., ['client', 'attorney', 'witness']

  // --- Case numbering ---
  numberPrefix: string              // e.g., "JS" → "JS-2026-0001"

  // --- Visibility ---
  isArchived: boolean

  createdAt: string
  updatedAt: string
}

interface EnumOption {
  value: string                     // Machine-readable value
  label: string                     // Display label (i18n key or literal)
  color?: string                    // UI color hint
  icon?: string                     // Optional icon
  order: number                     // Sort order
}
```

**Storage**: Part of `SettingsDO` (hub-scoped)
- `caseTypes` → CaseType[]

---

### 8. Report-Case Link

Many-to-many between reports (conversations with `type: 'report'`) and cases.

```typescript
interface ReportCaseLink {
  reportId: string                  // Conversation ID
  caseId: string
  linkedAt: string
  linkedBy: string                  // Pubkey
  encryptedNotes?: string           // Why this report is linked to this case
  notesEnvelopes?: RecipientEnvelope[]
}
```

**Storage**: Part of `CaseDO`
- `reportcase:{reportId}:{caseId}` → ReportCaseLink
- `casereports:{caseId}:{reportId}` → ReportCaseLink (reverse)

---

## Durable Object Architecture

### New DOs

| DO | Scope | Purpose |
|----|-------|---------|
| `ContactDirectoryDO` | Per-hub (`idFromName(hubId)`) | Contact profiles, relationships, affinity groups |
| `CaseDO` | Per-hub (`idFromName(hubId)`) | Cases, case-contacts, interactions, events, report-case links |

### Modified DOs

| DO | Change |
|----|--------|
| `SettingsDO` | Add `caseTypes`, `caseManagementEnabled`, `eventTypes` settings |
| `RecordsDO` | Add `caseId` field to notes for linking |

### Wrangler Bindings

```jsonc
// apps/worker/wrangler.jsonc — add to durable_objects.bindings
{ "name": "CONTACT_DIRECTORY", "class_name": "ContactDirectoryDO" },
{ "name": "CASE_MANAGER", "class_name": "CaseDO" }
```

---

## Blind Index Strategy

All filterable fields use HMAC blind indexes derived from a dedicated blind index key
(NOT the hub key — separate key for index operations, derived via HKDF from the hub key).

### Index Key Derivation

```typescript
// Derive per-field blind index keys from hub key (client-side)
// Following CipherSweet pattern: distinct key per field prevents cross-field correlation
function blindIndexKey(hubKey: Uint8Array, fieldName: string): Uint8Array {
  return hkdf(sha256, hubKey, 'llamenos:blind-index:' + fieldName, 'llamenos:blind-idx', 32)
}

function blindIndex(hubKey: Uint8Array, fieldName: string, value: string): string {
  const key = blindIndexKey(hubKey, fieldName)
  return bytesToHex(hmac(sha256, key, utf8ToBytes(canonicalize(value))))
}

// Canonicalize: lowercase, strip diacritics, trim whitespace
function canonicalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}
```

### Query Types

**Exact match (enums, status, severity, contact type):**
```typescript
blindIndex(hubKey, 'case-status', 'open')      // → "a1b2c3..."
blindIndex(hubKey, 'case-severity', 'red')      // → "d4e5f6..."
// Server: GET /records?statusHash=a1b2c3&severityHash=d4e5f6
```

**Date range queries (epoch bucketing):**
```typescript
// Store blind indexes at multiple granularities
function dateBlindIndexes(hubKey: Uint8Array, fieldName: string, date: Date): Record<string, string> {
  const day = date.toISOString().slice(0, 10)    // "2026-03-14"
  const week = `${date.getFullYear()}-W${isoWeek(date)}`  // "2026-W11"
  const month = date.toISOString().slice(0, 7)   // "2026-03"
  return {
    [`${fieldName}_day`]: blindIndex(hubKey, `${fieldName}:day`, day),
    [`${fieldName}_week`]: blindIndex(hubKey, `${fieldName}:week`, week),
    [`${fieldName}_month`]: blindIndex(hubKey, `${fieldName}:month`, month),
  }
}

// Query "last 7 days": compute 7 day-level tokens, query with OR
// Query "last quarter": compute 3 month-level tokens
// Server: GET /records?createdMonth=abc123,def456,ghi789
```

**Partial text search (name search via trigram tokenization):**
```typescript
// For contact name search: generate trigram tokens
function nameBlindIndexes(hubKey: Uint8Array, name: string): string[] {
  const normalized = canonicalize(name)
  const trigrams = new Set<string>()
  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.slice(i, i + 3))
  }
  return Array.from(trigrams).map(t => blindIndex(hubKey, 'name:trigram', t))
}

// "Carlos" → trigrams ["car", "arl", "rlo", "los"] → 4 HMAC tokens
// Search for "car" → compute blindIndex(hubKey, 'name:trigram', 'car') → match
// Server stores: idx:trigram:{token}:{contactId} → true
```

**Server-side filtering:**
```
GET /records?statusHash=a1b2c3&severityHash=d4e5f6&page=1&limit=20
GET /records?createdWeek=abc123&page=1&limit=20
GET /contacts?nameToken=xyz789&page=1&limit=20
```

### Security Properties

- **Per-field keys**: Each field's blind index uses a distinct HKDF-derived key, preventing
  cross-field correlation (knowing two records have the same status doesn't reveal severity).
- **Canonicalization**: Consistent normalization prevents duplicate indexes for "Carlos" vs "carlos".
- **Bloom filter truncation** (optional, for high-privacy fields): Truncate HMAC output to N bits
  to create controlled false positives. CipherSweet formula: maintain `2 <= C < sqrt(R)` expected
  coincidences where `C = R / 2^N`, R = row count, N = index bits.
- **Hub-scoped**: Keys are hub-specific, so blind indexes can't be correlated across hubs.
- **Blind index key rotation**: When a member departs, rotate the hub key → re-derive all blind
  index keys → re-index all records. This is expensive but necessary for forward secrecy.

---

## Encryption Strategy

### Per-Entity Encryption

| Entity | What's encrypted | Label | Envelope recipients |
|--------|-----------------|-------|-------------------|
| Contact profile | Name, identifiers, demographics | `LABEL_CONTACT_PROFILE` | All hub members with `contacts:view` |
| Case summary | Title, description, outcome | `LABEL_CASE_SUMMARY` | Assigned volunteers + admins |
| Case fields | Custom field values | `LABEL_CASE_FIELDS` | Same as case summary |
| Event details | Name, location, description | `LABEL_EVENT_DETAILS` | All hub members (events are shared context) |
| Interaction content | Inline comments/notes | `LABEL_CASE_SUMMARY` | Same as parent case |
| Affinity group | Name, members | `LABEL_CONTACT_PROFILE` | Admins + assigned case workers |

### Field-Level Access Control via Selective Envelopes

For cases where different roles should see different fields:

**Option A: Multiple encrypted blobs per case** (recommended)
- `encryptedSummary` → visible to all with `cases:read-*` — contains title, status, basic info
- `encryptedFields` → visible only to those with `cases:read-fields-{caseTypeId}` — contains sensitive custom fields
- `encryptedPII` → visible only to admins — contains names, phone numbers, legal details

Each blob has its own set of `RecipientEnvelope[]`. A volunteer might have envelopes for `encryptedSummary` but not for `encryptedPII`.

**Option B: Per-field encryption** (more granular but expensive)
- Each custom field value is individually encrypted with its own key
- Field definitions include a `visibilityLevel` that determines who gets envelopes
- Very fine-grained but generates many envelope operations

**Recommendation**: Start with Option A (3-tier: summary, fields, PII). It covers the 90% use case with manageable complexity. Per-field encryption can be added later for specific high-security deployments.

---

## Cross-Hub Contact Correlation

When cross-hub sharing is enabled:

1. **Contact identification**: Each hub maintains its own contacts independently. Cross-hub correlation happens via shared blind indexes of identifiers.
2. **Query flow**: When a hub admin searches for a contact, the client computes blind indexes locally and queries their hub's ContactDirectoryDO. If cross-hub is enabled, the query ALSO checks other opted-in hubs' ContactDirectoryDOs.
3. **Data sharing**: The source hub creates new ECIES envelopes wrapping the case/contact data for the target hub's super-admin key. Only shared fields are included.
4. **No automatic merging**: The system shows "this identifier has records in Hub B" but does NOT auto-merge contact profiles. Merging is a deliberate admin action.

---

## Case Numbering

Human-readable case numbers follow the pattern:
```
{PREFIX}-{YEAR}-{SEQUENCE}
```

Examples:
- `JS-2026-0042` (Jail Support case #42 of 2026)
- `LC-2026-0108` (Legal Case #108 of 2026)
- `ME-2026-0003` (Medical Encounter #3 of 2026)

The prefix comes from `CaseType.numberPrefix`. The sequence is a monotonically increasing counter stored in `CaseDO` as `caseNumberSeq:{prefix}:{year}`.

---

## Scale Considerations

**Target**: 1000+ active cases per hub during mass arrest events.

| Entity | Expected count per hub | Storage pattern |
|--------|----------------------|-----------------|
| Contacts | Hundreds to thousands | Per-contact key `contact:{id}` |
| Cases | Up to 1000+ active | Per-case key `case:{id}` |
| Interactions | 10-50 per case = 10,000-50,000 | Per-interaction key `interaction:{caseId}:{id}` |
| Events | Tens | Per-event key `event:{id}` |

**Pagination strategy**: Cursor-based for large result sets, offset-based for admin views.

**Index strategy**: Prefix-scan indexes (`idx:status:{hash}:{caseId}`) enable efficient server-side filtering without full table scans.

---

## New Crypto Labels Required

```json
{
  "LABEL_CONTACT_PROFILE": "llamenos:contact-profile",
  "LABEL_CASE_SUMMARY": "llamenos:case-summary",
  "LABEL_CASE_FIELDS": "llamenos:case-fields",
  "LABEL_EVENT_DETAILS": "llamenos:event-details",
  "HMAC_CONTACT_NAME": "llamenos:contact-name",
  "HMAC_CONTACT_TAG": "llamenos:contact-tag",
  "HMAC_CASE_STATUS": "llamenos:case-status",
  "HMAC_CASE_SEVERITY": "llamenos:case-severity",
  "HMAC_CASE_CATEGORY": "llamenos:case-category",
  "HMAC_EVENT_TYPE": "llamenos:event-type",
  "HMAC_EVENT_STATUS": "llamenos:event-status",
  "HMAC_BLIND_INDEX": "llamenos:blind-index"
}
```

These will be added to `packages/protocol/crypto-labels.json` and generated via codegen to TS/Swift/Kotlin.

---

## New Permission Domains Required

```typescript
// Cases
'cases:create': 'Create new cases',
'cases:read-own': 'Read cases assigned to self',
'cases:read-all': 'Read all cases in hub',
'cases:read-assigned': 'Read cases assigned to self or team',
'cases:update-own': 'Update cases assigned to self',
'cases:update': 'Update any case',
'cases:close': 'Close/resolve cases',
'cases:delete': 'Delete cases (admin only)',
'cases:assign': 'Assign cases to volunteers',
'cases:link': 'Link cases to reports/events/contacts',
'cases:manage-types': 'Create/edit case type definitions',

// Contacts (extend existing)
'contacts:create': 'Create new contacts',
'contacts:edit': 'Edit contact profiles',
'contacts:delete': 'Delete contacts',
'contacts:merge': 'Merge duplicate contacts',
'contacts:view-pii': 'View contact PII (name, phone)',
'contacts:manage-relationships': 'Manage contact relationships',
'contacts:manage-groups': 'Manage affinity groups',

// Events
'events:create': 'Create events',
'events:read': 'View events',
'events:update': 'Update events',
'events:delete': 'Delete events',
'events:link': 'Link events to cases/reports',

// Evidence
'evidence:upload': 'Upload evidence files to cases',
'evidence:download': 'Download evidence from cases',
'evidence:manage-custody': 'Manage chain of custody records',
```

---

## Telephony-CRM Integration (Differentiator)

Llamenos has a built-in telephony platform (parallel ringing, WebRTC, multi-channel messaging)
that most social services CRMs lack. This enables deep integration between the call center
and case management that is normally only available in enterprise sales CRMs (Salesforce CTI).

### Screen Pop — Caller Identification

When an incoming call arrives, the system can identify the caller:

```
1. Call arrives with caller phone number
2. Server computes contactHash = HMAC(hmacSecret, phone)
3. Server checks ContactDirectoryDO for matching identifierHash
4. If found: sends contactId + caseCount via Nostr event to volunteer's client
5. Client decrypts contact profile and shows:
   - Contact name (from encrypted profile)
   - Active cases (count, most recent)
   - Risk flags (case severity, open protection orders, medical needs)
   - Last interaction summary
6. Volunteer sees this BEFORE answering (on the ring screen)
```

**Privacy-safe**: The contactHash lookup is server-side (HMAC of phone).
The actual contact profile is decrypted client-side. The server never sees the name.

**New Nostr event kind**: `KIND_CONTACT_IDENTIFIED = 20007`
```typescript
// Event payload (encrypted with hub key):
{
  type: 'contact:identified',
  callId: string,
  contactId: string,
  caseCount: number,
  // Client decrypts contact profile and case summaries locally
}
```

### Auto-Linking: Calls → Contacts → Cases

When a volunteer creates a note during or after a call:

```
1. Note is linked to callId (existing behavior)
2. If caller was identified (contactHash match):
   a. Note is also linked to contactId (new)
   b. If contact has active cases:
      - UI shows "Link to case?" dropdown with active cases
      - Selected case gets an Interaction record linking the note
3. If caller was NOT identified:
   a. UI prompts "Create new contact?"
   b. If yes: creates Contact from call metadata (phone → identifier)
```

### Case-Initiated Communication

From within a case detail view:

```
1. Volunteer sees case contacts with their identifiers (phone, Signal, etc.)
2. "Call" button → initiates outbound call through TelephonyAdapter
3. "Message" button → opens conversation composer for Signal/SMS/WhatsApp
4. The resulting call/message is automatically linked to the case
5. Support contacts can receive case updates via their preferred channel
```

**Integration with support contact notifications** (Epic 327):
When a case status changes (e.g., `in_custody` → `released`), all support contacts
with notification preferences get an update via their preferred messaging channel.

### Inbound Message → Case Routing

When an SMS/Signal/WhatsApp message arrives from a known contact:

```
1. Message arrives on ConversationDO (existing flow)
2. Server matches contactIdentifierHash against ContactDirectoryDO
3. If contact has active cases:
   a. Volunteer sees "Active cases for this contact" in the conversation view
   b. Can link the conversation to a specific case
   c. Messages in the conversation become case interactions
4. If contact is a support contact for other people's cases:
   a. Volunteer sees "Support contact for: [list of contacts with cases]"
   b. Can route the message to the appropriate case
```

### Call Recording as Evidence

When a call recording is available (existing feature, admin-enabled):

```
1. Call recording is encrypted (existing ECIES model)
2. If the call is linked to a case:
   a. Recording becomes a case file attachment
   b. Chain-of-custody metadata is auto-populated:
      - Recorded at: call start time
      - Recorded by: telephony provider (Twilio, etc.)
      - Integrity hash: SHA-256 of encrypted recording
      - Custodian: system (auto-recorded, no human handling)
3. Recording appears in case timeline as an Interaction
```

### Real-Time Case Updates

During an active call, the case detail view is live:

```
1. Volunteer opens case while on a call
2. Status/field changes are saved immediately (existing API)
3. Other volunteers viewing the same case see real-time updates (Nostr events)
4. Case timeline logs each field change with the volunteer's pubkey and timestamp
5. If the call is recorded, the timeline entry links to the recording timestamp
```

---

## Migration Path

This system is additive — no existing data needs to change. The path is:

1. Add new DOs (`ContactDirectoryDO`, `CaseDO`)
2. Add new crypto labels
3. Add new permissions
4. Extend `SettingsDO` with entity type definitions, template storage
5. Add new routes (`/api/records/*`, `/api/contacts/*`, `/api/events/*`)
6. Add telephony-CRM hooks (screen pop, auto-link, case-initiated calling)
7. Build desktop UI (schema-driven forms, case timeline, contact directory)
8. (Later) Build mobile UI for jail support
9. (Later) Activity timelines and workflow automation (CiviCRM-style)
