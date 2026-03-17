# Epic 362: Permission Granularity Overhaul

**Status**: PENDING
**Priority**: High
**Depends on**: None
**Blocks**: None
**Branch**: `desktop`

## Summary

Audit and fix the permission system — 10 categories of issues found: phantom permissions (4), overloaded permissions (3), missing guards (8 endpoints), cross-domain borrowing (3), missing role assignments (2), and data leakage (1). Split coarse permissions, add missing catalog entries, fix unguarded endpoints, and expand the permission-matrix BDD tests to cover all API endpoints.

## Problem Statement

The permission system grew organically as features were added. Permissions were reused across semantically different endpoints rather than creating purpose-specific ones. This creates:

1. **Over-privileged roles** — a hub-admin who should manage shifts also gets WebAuthn settings because both use `settings:manage`
2. **Phantom permissions** — 4 permissions used in code don't exist in the catalog (`contacts:manage`, `cases:manage`, `contacts:update`, `evidence:read`)
3. **Unguarded endpoints** — 8 GET endpoints expose configuration without any permission check
4. **Data leakage** — `/volunteers/:pk/cases` exposes case data to anyone with `volunteers:read`

## Findings

### A. Phantom Permissions (4)

| Permission | Location | Fix |
|-----------|----------|-----|
| `contacts:manage` | `routes/contacts.ts` (legacy v1) | Add to catalog OR replace with `contacts:view` |
| `cases:manage` | `routes/entity-schema.ts` (auto-assignment) | Add to catalog with appropriate role assignment |
| `contacts:update` | `routes/dev.ts` (test only) | Add to catalog |
| `cases:read`, `evidence:read` | `routes/dev.ts` (test only) | Add to catalog |

### B. Overloaded Permissions

**`calls:answer`** — gates 3 different operations:
| Endpoint | Current | Should Be |
|----------|---------|-----------|
| `POST /calls/:id/answer` | `calls:answer` | `calls:answer` (keep) |
| `POST /calls/:id/hangup` | `calls:answer` | `calls:hangup` (new) |
| `POST /calls/:id/spam` | `calls:answer` | `calls:report-spam` (new) |

**`settings:manage`** — gates 6+ endpoint groups:
| Endpoint Group | Current | Should Be |
|---------------|---------|-----------|
| Call settings | `settings:manage` | `settings:manage-calls` (new) |
| WebAuthn settings | `settings:manage` | `settings:manage-webauthn` (new) |
| Setup wizard | `settings:manage` | `settings:manage-setup` (new) |
| TTL overrides | `settings:manage` | `settings:manage-ttl` (new) |
| Cleanup metrics | `settings:manage` | `settings:manage` (keep for admin-only) |
| CMS toggle | `settings:manage` | `settings:manage-cms` (new) |

**`cases:link`** — gates both link AND unlink:
- Consider splitting into `cases:link` and `cases:unlink`, or keep as-is if the risk differential is low

### C. Unguarded Endpoints (8)

| Endpoint | Risk | Fix |
|----------|------|-----|
| `GET /settings/roles` | Exposes RBAC structure | Add `settings:read` or `system:view-roles` |
| `GET /settings/report-types` | Config exposure | Add `settings:read` |
| `GET /calls/:id/recording` | Inline-only guard | Add `calls:read-history` middleware |
| `GET /cms/auto-assignment` | Config exposure | Add `settings:read` or `cases:read-own` |
| `GET /cms/case-management` | Config exposure | Same |
| `GET /cms/cross-hub` | Config exposure | Same |
| `GET /hubs` | Hub list visible to all | Add `system:view-hubs` or leave open (low risk) |
| `GET /hubs/:id` | Hub detail visible to all | Same |

### D. Cross-Domain Permission Borrowing (3)

| Endpoint | Current | Fix |
|----------|---------|-----|
| `GET /calls/identify/:hash` | `contacts:view` | Add `calls:identify-caller` (new) OR keep if intentional |
| `POST /calls/:id/ban` | `bans:report` | Keep (correct — banning IS a bans domain operation) |
| `POST /hubs/:id/members` | `volunteers:manage-roles` | Add `hubs:manage-members` (new) |

### E. Missing Role Assignments (2)

| Permission | Missing From | Fix |
|-----------|-------------|-----|
| `settings:read` | All non-admin roles | Add to reviewer + volunteer (needed for entity type list in record forms) |
| `calls:read-presence` | Volunteer role | Add (volunteers need to see who's online) |

### F. Data Leakage (1)

`GET /volunteers/:pk/cases` and `/volunteers/:pk/metrics` — any user with `volunteers:read` can access case data for any volunteer. Should require `cases:read-assigned` or `cases:read-all` additionally.

## Implementation

### Phase 1: Add Missing Catalog Entries
- Add phantom permissions to `PERMISSION_CATALOG`
- Add new split permissions (`calls:hangup`, `calls:report-spam`, `settings:manage-calls`, etc.)
- Update default roles to include new permissions (backward-compatible — hub-admin gets all new ones)

### Phase 2: Update Route Guards
- Split overloaded `requirePermission()` calls
- Add guards to unguarded endpoints
- Fix cross-domain borrowing where appropriate
- Add `cases:read-assigned` guard to volunteer case data endpoints

### Phase 3: Update Permission Matrix Tests
- Add scenarios for ALL missing endpoint coverage (~40 endpoints not tested)
- Add scenarios for the new split permissions
- Verify all 5 default roles against every guarded endpoint

### Phase 4: Codegen + Client Updates
- Run `bun run codegen` (permission catalog is exported as constants)
- Update mobile clients if they reference permission strings directly

## Acceptance Criteria

- [ ] Zero phantom permissions — every `requirePermission()` call uses a cataloged permission
- [ ] `calls:answer` split into answer/hangup/report-spam
- [ ] `settings:manage` split into domain-specific sub-permissions
- [ ] All 8 unguarded GET endpoints have appropriate guards
- [ ] Permission matrix BDD tests cover ALL API endpoints
- [ ] Default roles updated with new permissions (backward-compatible)
- [ ] No data leakage through volunteer case/metrics endpoints
- [ ] `settings:read` added to reviewer and volunteer roles
- [ ] `calls:read-presence` added to volunteer role
