# Epic 362: Permission Granularity Overhaul — 20 New Permissions

**Status**: PENDING
**Priority**: High
**Depends on**: None
**Blocks**: None
**Branch**: `desktop`

## Summary

Expand the permission system from 73 to 93 permissions across 19 domains. Split overloaded permissions (`calls:answer`, `settings:manage`), add guards to 8 unguarded endpoints, fix 5 phantom permissions, resolve 3 cross-domain borrowing issues, fix 1 data leakage path, and expand the permission-matrix BDD tests to cover all API endpoints.

## Problem Statement

Permissions were reused across semantically different endpoints as features grew. A hub-admin who should only manage shifts also gets WebAuthn settings because both use `settings:manage`. Endpoints like `GET /settings/roles` have no permission guard at all. 5 permissions used in code don't exist in the catalog.

## New Permissions (20)

| # | Permission | Description | Default Roles |
|---|-----------|-------------|---------------|
| 1 | `calls:hangup` | Hang up an active call | volunteer, hub-admin |
| 2 | `calls:report-spam` | Report a call as spam | volunteer, hub-admin |
| 3 | `calls:identify-caller` | Identify caller by hash (screen pop) | volunteer, reviewer, hub-admin |
| 4 | `contacts:search` | Search contacts directory | volunteer, reviewer, hub-admin |
| 5 | `contacts:export` | Export contact data | hub-admin |
| 6 | `reports:read-types` | View report type definitions | reporter, volunteer, reviewer, hub-admin |
| 7 | `volunteers:read-cases` | View case records assigned to a volunteer | reviewer, hub-admin |
| 8 | `volunteers:read-metrics` | View volunteer workload metrics | reviewer, hub-admin |
| 9 | `settings:manage-calls` | Modify call timeout, voicemail length | hub-admin |
| 10 | `settings:manage-webauthn` | Modify WebAuthn settings | hub-admin |
| 11 | `settings:manage-setup` | Setup wizard access | hub-admin |
| 12 | `settings:manage-ttl` | Modify TTL/cleanup intervals | hub-admin |
| 13 | `settings:manage-cms` | Toggle case management feature | hub-admin |
| 14 | `cases:manage` | Auto-assignment config (was phantom) | hub-admin |
| 15 | `cases:unlink` | Unlink records from reports/events/contacts | reviewer, hub-admin |
| 16 | `hubs:read` | View hub list and details | volunteer, reviewer, hub-admin |
| 17 | `hubs:manage-members` | Add/remove members from hubs | hub-admin |
| 18 | `hubs:manage-keys` | Manage hub key envelopes | hub-admin |
| 19 | `metrics:read` | View system metrics (split from audit:read) | hub-admin |
| 20 | `system:view-roles` | View role definitions (was unguarded) | hub-admin |

## Route Guard Changes (25 fixes)

### `calls:answer` split (3 fixes)
| Endpoint | Before | After |
|----------|--------|-------|
| `POST /calls/:id/hangup` | `calls:answer` | `calls:hangup` |
| `POST /calls/:id/spam` | `calls:answer` | `calls:report-spam` |
| `GET /calls/identify/:hash` | `contacts:view` | `calls:identify-caller` |

### `settings:manage` split (8 fixes)
| Endpoint | Before | After |
|----------|--------|-------|
| `GET/PATCH /settings/call` | `settings:manage` | `settings:manage-calls` |
| `GET/PATCH /settings/webauthn` | `settings:manage` | `settings:manage-webauthn` |
| `GET/PATCH /settings/setup` | `settings:manage` | `settings:manage-setup` |
| `POST /setup/complete` | `settings:manage` | `settings:manage-setup` |
| `GET/PATCH /settings/ttl` | `settings:manage` | `settings:manage-ttl` |
| `PUT /cms/case-management` | `settings:manage` | `settings:manage-cms` |
| `PUT /cms/cross-hub` | `settings:manage` | `settings:manage-cms` |

### Unguarded endpoints (8 fixes)
| Endpoint | Before | After |
|----------|--------|-------|
| `GET /settings/roles` | None | `system:view-roles` |
| `GET /settings/report-types` | None | `settings:read` |
| `GET /calls/:id/recording` | Inline only | `calls:read-recording` middleware |
| `GET /cms/auto-assignment` | None | `settings:read` |
| `GET /cms/case-management` | None | `settings:read` |
| `GET /cms/cross-hub` | None | `settings:read` |
| `GET /hubs` | None | `hubs:read` |
| `GET /hubs/:id` | None | `hubs:read` |

### Cross-domain fixes (3 fixes)
| Endpoint | Before | After |
|----------|--------|-------|
| `POST /hubs/:id/members` | `volunteers:manage-roles` | `hubs:manage-members` |
| `DELETE /hubs/:id/members/:pk` | `volunteers:manage-roles` | `hubs:manage-members` |
| `PUT /hubs/:id/key` | `system:manage-hubs` | `hubs:manage-keys` |

### Data leakage fixes (2 fixes)
| Endpoint | Before | After |
|----------|--------|-------|
| `GET /volunteers/:pk/cases` | `volunteers:read` only | + `volunteers:read-cases` |
| `GET /volunteers/:pk/metrics` | `volunteers:read` only | + `volunteers:read-metrics` |

### Metrics split (1 fix)
| Endpoint | Before | After |
|----------|--------|-------|
| `GET /metrics` | `audit:read` | `metrics:read` |

### Phantom permission fixes (5 fixes)
| Code Reference | Before | After |
|---------------|--------|-------|
| `routes/contacts.ts` (v1 legacy) | `contacts:manage` (phantom) | `contacts:view` |
| `routes/entity-schema.ts` auto-assignment | `cases:manage` (phantom) | `cases:manage` (added to catalog) |
| `routes/dev.ts` | `contacts:update` (phantom) | `contacts:edit` |
| `routes/dev.ts` | `cases:read` (phantom) | `cases:read-all` |
| `routes/dev.ts` | `evidence:read` (phantom) | `evidence:download` |

## Default Role Updates

### `settings:read` added to volunteer + reviewer
Volunteers and reviewers need `settings:read` to load entity type definitions in record forms. Currently only accessible through wildcard.

### `calls:read-presence` added to volunteer
Volunteers need to see who else is online. Currently missing from the default volunteer role.

### `calls:hangup` + `calls:report-spam` added to volunteer
Previously inherited through `calls:answer` reuse. Now explicit.

### `calls:identify-caller` added to volunteer + reviewer
Previously inherited through `contacts:view` cross-domain. Now explicit in calls domain.

### `hubs:read` added to volunteer + reviewer
Hub list visibility for multi-hub navigation.

## Implementation

### Phase 1: Catalog + Role Updates
1. Add 20 new permissions to `PERMISSION_CATALOG` in `packages/shared/permissions.ts`
2. Update `DEFAULT_ROLES` with new permission assignments
3. Run `bun run codegen` (permission catalog is exported)

### Phase 2: Route Guard Updates
1. Update all 25 `requirePermission()` calls across route files
2. Add `requirePermission()` middleware to 8 unguarded endpoints
3. Fix 5 phantom permission references

### Phase 3: BDD Test Expansion
1. Add permission-matrix scenarios for ALL missing endpoints (~40 endpoints not covered)
2. Update existing scenarios for split permissions
3. Add scenarios for the new `hubs:*` and `metrics:read` permissions

### Phase 4: Migration
1. Existing custom roles that include `settings:manage` automatically get the sub-permissions via domain wildcard (`settings:*`)
2. Roles with `calls:answer` get `calls:hangup` + `calls:report-spam` added
3. No breaking changes for `super-admin` (wildcard) or `hub-admin` (domain wildcards)

## Files to Modify

| File | Changes |
|------|---------|
| `packages/shared/permissions.ts` | Add 20 permissions, update 5 role defaults |
| `apps/worker/routes/calls.ts` | Split calls:answer → hangup/spam, add recording guard |
| `apps/worker/routes/settings.ts` | Split settings:manage → 5 sub-permissions |
| `apps/worker/routes/entity-schema.ts` | Fix phantom cases:manage, add read guards |
| `apps/worker/routes/hubs.ts` | Add hubs:read, hubs:manage-members, hubs:manage-keys |
| `apps/worker/routes/volunteers.ts` | Add read-cases, read-metrics guards |
| `apps/worker/routes/contacts.ts` | Fix phantom contacts:manage |
| `apps/worker/routes/setup.ts` | Split settings:manage → manage-setup |
| `apps/worker/routes/metrics.ts` | Split audit:read → metrics:read |
| `apps/worker/routes/dev.ts` | Fix 3 phantom permissions |
| `packages/test-specs/features/security/permission-matrix.feature` | Add ~40 new scenarios |

## Acceptance Criteria

- [ ] 93 permissions in PERMISSION_CATALOG (73 existing + 20 new)
- [ ] Zero phantom permissions — every requirePermission() uses a cataloged permission
- [ ] `calls:answer` only gates answering (not hangup/spam)
- [ ] `settings:manage` only gates cleanup metrics (not calls/webauthn/setup/ttl/cms)
- [ ] All 8 previously unguarded GET endpoints have permission guards
- [ ] `GET /volunteers/:pk/cases` requires `volunteers:read-cases`
- [ ] `GET /metrics` requires `metrics:read` (not `audit:read`)
- [ ] Hub membership uses `hubs:manage-members` (not `volunteers:manage-roles`)
- [ ] `settings:read` assigned to volunteer and reviewer roles
- [ ] `calls:read-presence` assigned to volunteer role
- [ ] Permission-matrix BDD tests cover all guarded endpoints
- [ ] `bun run codegen` produces updated permission constants
- [ ] All BDD tests pass
- [ ] Backward-compatible — existing wildcard roles unaffected

## Risk Assessment

- **Low risk**: All changes are additive — new permissions + narrower guards
- **Low risk**: `super-admin` has `['*']` — unaffected by any changes
- **Low risk**: `hub-admin` uses domain wildcards (`settings:*`, `calls:*`) — inherits new sub-permissions automatically
- **Medium risk**: Custom roles that used `settings:manage` explicitly (not via wildcard) will lose access to the split-out sub-permissions. Migration adds the sub-permissions.
- **No breaking changes** for any default role
