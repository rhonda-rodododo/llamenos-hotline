# Case Management System — RBAC Matrix

**Date**: 2026-03-14
**Status**: DRAFT — evolving as research completes
**Purpose**: Define the complete permission model for case management, including
entity-type-level, field-level, and record-level access control. Shows how envelope-based
encryption implements RBAC without server-side enforcement.

---

## Permission Architecture: Three Layers

### Layer 1: Permission Catalog (Server-Enforced)

Traditional RBAC — the server checks permissions before executing operations.
These extend the existing `PERMISSION_CATALOG` in `packages/shared/permissions.ts`.

```typescript
// --- Cases ---
'cases:create': 'Create new cases/records',
'cases:read-own': 'Read records assigned to self',
'cases:read-assigned': 'Read records assigned to self or team',
'cases:read-all': 'Read all records in hub',
'cases:update-own': 'Update records assigned to self',
'cases:update': 'Update any record',
'cases:close': 'Close/resolve records',
'cases:delete': 'Delete records (admin only)',
'cases:assign': 'Assign records to volunteers',
'cases:link': 'Link records to reports/events/contacts',
'cases:manage-types': 'Create/edit entity type definitions',
'cases:import': 'Bulk import records',
'cases:export': 'Bulk export records',

// --- Contacts ---
'contacts:create': 'Create new contacts',
'contacts:edit': 'Edit contact profiles',
'contacts:delete': 'Delete contacts',
'contacts:merge': 'Merge duplicate contacts',
'contacts:view-pii': 'View contact PII (name, phone, demographics)',
'contacts:manage-relationships': 'Manage contact relationships',
'contacts:manage-groups': 'Manage affinity groups',

// --- Events ---
'events:create': 'Create events',
'events:read': 'View events',
'events:update': 'Update events',
'events:delete': 'Delete events',
'events:link': 'Link events to records/reports',

// --- Evidence / Files (extend existing files:* domain) ---
'evidence:upload': 'Upload evidence files to records',
'evidence:download': 'Download evidence from records',
'evidence:manage-custody': 'Manage chain of custody records',
'evidence:delete': 'Delete evidence files',
```

### Layer 2: Entity-Type-Level Access (Schema-Enforced)

Controls which entity types a role can see/modify. Defined in the role's permissions
using a `cases:read-type:{entityTypeId}` pattern.

```typescript
// Pattern: cases:{action}-type:{entityTypeId}
'cases:read-type:arrest_case': 'Read arrest cases',
'cases:read-type:medical_encounter': 'Read medical encounters',
'cases:update-type:arrest_case': 'Update arrest cases',

// Wildcard still works: cases:* covers all entity types
// Domain wildcard: cases:read-type:* covers all entity types for reading
```

**How it works:**
1. Role definition includes entity-type-specific permissions
2. When fetching records, the server filters by entity type permissions
3. A "Jail Support Coordinator" has `cases:*-type:arrest_case` but NOT `*-type:medical_encounter`

**Alternative (simpler, recommended for v1):**
Instead of per-type permissions, use entity type definitions to specify which roles
can access them:

```typescript
interface EntityTypeDefinition {
  // ...
  accessRoles: string[]             // Role IDs that can access this type
  editRoles: string[]               // Role IDs that can edit this type
  // Empty = falls back to generic cases:* permissions
}
```

This keeps the permission catalog simpler and puts the configuration in the entity type
definition where it belongs.

### Layer 3: Field-Level Access (Envelope-Enforced)

The most powerful layer — who gets a decryption envelope for each field determines
who can read it. The server CANNOT enforce this; it's a client-side decision.

**Three-tier encryption per record:**

| Tier | Envelope Recipients | Contains | Use Case |
|------|-------------------|----------|----------|
| **Summary** | All with `cases:read-*` for this type | Title, status, category, basic info | List views, search results |
| **Fields** | Assigned volunteers + admins | All custom field values | Case detail view |
| **PII** | Admins only (or specific roles) | Names, phone numbers, addresses | Contact PII, legal details |

**How it works:**
1. Entity type definition marks fields with `accessLevel: 'all' | 'admin' | 'assigned'`
2. When creating/updating a record, the client groups fields by access level
3. Each group is encrypted with its own symmetric key
4. Each key gets ECIES envelopes only for the roles that should see it
5. The server stores all three encrypted blobs + envelopes, but can't read any of them

**Example: Arrest Case**

```
Summary (everyone with cases:read-*):
  - Case number, status, severity, arrest date

Fields (assigned jail support volunteer + admins):
  - Charges, bail amount, court date, attorney status
  - Booking number, precinct, release status

PII (admins only):
  - Arrestee name, phone number, physical description
  - Attorney name and contact info
```

A volunteer assigned to a case can see the charges and court dates but NOT the
arrestee's real name (they see a case number and physical description).

---

## Role Matrix: Default Templates

### Base Roles (ship with system, extend existing)

| Role | Category | Cases | Contacts | Events | Evidence | Notes |
|------|----------|-------|----------|--------|----------|-------|
| **Super Admin** | `*` | `*` | `*` | `*` | `*` | Read/write all tiers |
| **Hub Admin** | `cases:*` | `contacts:*` | `events:*` | `evidence:*` | Read/write all tiers |
| **Volunteer** | `cases:create, cases:read-own, cases:update-own` | `contacts:view` | `events:read` | `evidence:upload` | Summary + Fields tiers |
| **Reporter** | — | — | — | — | Summary tier only |

### Template-Specific Roles (created when template is applied)

#### NLG Legal Observer Template

| Role | Description | Cases Permissions | Field Access |
|------|------------|------------------|-------------|
| **Hotline Coordinator** | Manages hotline operations | `cases:*, events:*, contacts:*` | All tiers |
| **Intake Volunteer** | Takes arrest reports | `cases:create, cases:read-own, contacts:create` | Summary + Fields |
| **Jail Support Coordinator** | Tracks arraignments/release | `cases:read-all, cases:update, contacts:view-pii` | All tiers |
| **Legal Observer** | Submits field observations | `reports:create, events:read` | Summary only |
| **Attorney Coordinator** | Matches attorneys | `cases:assign, cases:read-all, contacts:view-pii` | All tiers |

#### Street Medic Template

| Role | Description | Cases Permissions | Field Access |
|------|------------|------------------|-------------|
| **Medic Team Lead** | Coordinates team | `cases:*, contacts:*` | All tiers |
| **Street Medic** | Documents encounters | `cases:create, cases:read-own, cases:update-own` | Summary + Fields |
| **Follow-Up Coordinator** | Tracks hospital referrals | `cases:read-all, contacts:view-pii` | All tiers |

#### DV/IPV Crisis Template

| Role | Description | Cases Permissions | Field Access |
|------|------------|------------------|-------------|
| **Crisis Advocate** | Hotline response | `cases:create, cases:read-own, cases:update-own` | Summary + Fields |
| **Shelter Coordinator** | Manages placement | `cases:read-all, cases:update` | All tiers |
| **Legal Advocate** | Protection orders | `cases:read-assigned, contacts:view-pii` | Fields + PII |
| **Supervisor** | Reviews high-risk cases | `cases:read-all, contacts:view-pii` | All tiers |

---

## Envelope Decision Matrix

When a record is created or updated, the client must decide who gets envelopes.
This matrix shows the decision logic:

```
For each encrypted tier of a record:
  1. Get the entity type definition
  2. Get the access level for this tier (summary/fields/pii)
  3. Determine recipients based on access level:

  Summary tier:
    - All hub members with cases:read-* for this entity type
    - OR: all hub members (if entity type has no access restrictions)
    - ALWAYS: hub admins

  Fields tier:
    - Assigned volunteers (record.assignedTo[])
    - Hub admins with cases:read-all
    - Specific roles listed in EntityTypeDefinition.editRoles

  PII tier:
    - Hub admins only
    - Specific roles with contacts:view-pii

  4. For each recipient pubkey:
     a. Generate random symmetric key
     b. Encrypt the field group with XChaCha20-Poly1305
     c. Wrap the key via ECIES for the recipient's pubkey
     d. Create RecipientEnvelope { pubkey, wrappedKey, ephemeralPubkey }
```

### Envelope Re-Encryption Triggers

Envelopes need to be re-created when:

| Trigger | Action |
|---------|--------|
| Case assigned to new volunteer | Add field-tier envelope for new assignee |
| Case unassigned from volunteer | Remove their envelope (re-encrypt with new key) |
| New admin added to hub | Add all-tier envelopes for new admin |
| Admin removed from hub | Re-encrypt all records (key rotation) |
| Role permissions changed | Re-evaluate who should have envelopes |
| Contact PII updated | Re-encrypt PII tier with new key |

**Performance consideration**: Mass re-encryption (admin added/removed) is expensive.
Strategy: queue background re-encryption via DO alarm. Mark records as "pending re-encryption"
and process in batches.

---

## Cross-Hub Access Control

### Default: Hub-Isolated

Each hub's data is completely separate. Hub A cannot see Hub B's records.

### Opt-In: Super-Admin Visibility

When enabled per hub:
1. Hub admin toggles "Share with super-admins" in hub settings
2. The client creates new summary-tier envelopes for super-admin pubkeys
3. Super-admins can see case summaries (but NOT fields or PII unless explicitly shared)
4. Super-admins access cross-hub data via a separate "Cross-Hub" view

### Opt-In: Hub-to-Hub Referral

1. Hub A creates a "referral" — a summary of a case + relevant contact info
2. Hub A encrypts the referral for Hub B's admin pubkeys
3. Hub B receives the referral and can create their own case for the same contact
4. The two cases are linked via shared contact identifier hashes (blind indexes)
5. Each hub maintains independent records with independent envelopes

---

## Mapping to Existing Permission System

### New Permission Domains

| Domain | Permissions |
|--------|-----------|
| `cases` | `create`, `read-own`, `read-assigned`, `read-all`, `update-own`, `update`, `close`, `delete`, `assign`, `link`, `manage-types`, `import`, `export` |
| `contacts` | `create`, `edit`, `delete`, `merge`, `view-pii`, `manage-relationships`, `manage-groups` (extend existing `view`, `view-history`) |
| `events` | `create`, `read`, `update`, `delete`, `link` |
| `evidence` | `upload`, `download`, `manage-custody`, `delete` |

### Updated Default Roles

```typescript
// Hub Admin — add case management permissions
{
  id: 'role-hub-admin',
  permissions: [
    // ... existing permissions ...
    'cases:*', 'contacts:*', 'events:*', 'evidence:*',
  ],
}

// Volunteer — add basic case management
{
  id: 'role-volunteer',
  permissions: [
    // ... existing permissions ...
    'cases:create', 'cases:read-own', 'cases:update-own',
    'contacts:view', 'events:read',
    'evidence:upload',
  ],
}

// Reviewer — add case review
{
  id: 'role-reviewer',
  permissions: [
    // ... existing permissions ...
    'cases:read-assigned', 'cases:update',
    'contacts:view', 'contacts:view-pii',
    'events:read',
    'evidence:download',
  ],
}
```

---

## Field-Level Visibility Matrix (Example: Arrest Case)

| Field | Intake Vol | JS Coordinator | Attorney Coord | Hub Admin | Reporter |
|-------|-----------|----------------|----------------|-----------|----------|
| Case Number | R | R | R | RW | — |
| Status | R | RW | R | RW | — |
| Severity | R | RW | R | RW | — |
| Arrest Location | R | R | R | RW | — |
| Arrest Time | R | R | R | RW | — |
| Charges | R | RW | R | RW | — |
| Bail Amount | — | RW | R | RW | — |
| Court Date | — | RW | R | RW | — |
| Attorney Status | R | RW | RW | RW | — |
| Booking Number | — | R | — | RW | — |
| **Arrestee Name** | — | — | R | RW | — |
| **Phone Number** | — | — | — | RW | — |
| **Physical Desc** | R | R | — | RW | — |
| **Medical Needs** | R | RW | — | RW | — |

**R** = Read, **RW** = Read/Write, **—** = No access

Bold fields are PII-tier. Non-bold are summary or fields tier.

The field visibility is enforced by which encrypted tier the field belongs to:
- Summary tier (Case Number, Status, Severity) → visible to all with `cases:read-*`
- Fields tier (Charges, Bail, Court Date, etc.) → visible to assigned + admins
- PII tier (Name, Phone) → visible to admins + specifically authorized roles

---

## Security Considerations

### Envelope = Access

The fundamental security property: **if you don't have an envelope, you can't read the data.**
The server stores encrypted blobs and can't distinguish between fields. This means:

1. **Server compromise doesn't expose case data** — attacker gets encrypted blobs and blind indexes
2. **Role changes take effect at re-encryption** — changing a role doesn't retroactively remove access to already-decrypted data (the user already has the symmetric key for records they've seen)
3. **Key rotation is the hard problem** — when a volunteer leaves, their previously-held keys are potentially compromised. Forward secrecy (per-record random keys) limits the blast radius.

### Audit Trail

Every envelope operation (create, modify, re-encrypt) is logged in the audit trail:
- Who created the envelope (actor pubkey)
- For whom (recipient pubkey)
- For which record
- At what time

This creates an auditable record of who had access to what data and when.

### Blind Index Privacy

Blind indexes enable server-side filtering but leak some information:
- The server knows two records have the same status (same hash)
- The server knows the cardinality of each status value
- The server does NOT know what the status values mean (unless the enum set is very small)

**Mitigation**: Use hub-key-derived HMAC keys, so blind indexes are hub-specific.
The server can't correlate statuses across hubs even if the values are the same.
