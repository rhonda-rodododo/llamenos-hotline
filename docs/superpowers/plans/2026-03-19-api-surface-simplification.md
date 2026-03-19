# API Surface Simplification: CRUD Factory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a `createEntityRouter()` factory in `apps/worker/lib/entity-router.ts` that eliminates ~60% of route boilerplate across 9 entities while preserving exact OpenAPI output, type safety, and BDD test behavior.

**Architecture:** The factory produces a `Hono<AppEnv>` sub-router pre-wired with `describeRoute()`, `requirePermission()`, and `validator()` middleware for list/get/create/update/delete endpoints, controlled entirely by a typed config object. Each migrated entity file deletes its CRUD handler blocks and replaces them with a single `createEntityRouter(config)` call; custom endpoints (sub-resources, non-standard permissions, side effects) remain as hand-written handlers on the same router.

**Tech Stack:** Hono v4, hono-openapi (describeRoute/resolver/validator), Zod v4, Bun test runner (vitest-compatible), TypeScript strict mode.

---

## Key Design Observations from Codebase Audit

Before implementing, note these patterns discovered in the actual route files:

1. **`okResponseSchema` for deletes**: Shifts/bans/invites/volunteers use `okResponseSchema` as the delete response schema — the factory must accept it via `deleteResponseSchema` config or default to `itemResponseSchema`.
2. **Hub-scoped vs global**: `shifts.ts` passes `hubId = c.get('hubId') ?? ''` (coerces undefined), `bans.ts` uses `c.get('hubId')` (passes undefined). The factory's `hubScoped` flag should pass raw `c.get('hubId')` — callers that need `?? ''` handle it in the service.
3. **Global permission middleware on router**: `volunteers.ts` uses `volunteers.use('*', requirePermission('volunteers:read'))` to apply a blanket guard; the factory does NOT replicate this pattern — it guards each endpoint individually via its `domain` config.
4. **Audit call shape**: `audit(services.audit, eventName, pubkey, details?)` — details are optional. The factory calls `audit()` when `auditEvents` is provided.
5. **`requireAnyPermission` variant**: `entity-schema.ts`'s entity-types GET uses `requireAnyPermission(...)` (OR logic) — this cannot be expressed via the factory's single `domain` prefix. That endpoint stays hand-written.
6. **`idParam` naming**: Volunteers use `targetPubkey`, hubs use `hubId`, bans use `phone`, all others use `id`. The factory's `idParam` option covers this.
7. **Response wrapping**: Some handlers wrap results (`return c.json({ shifts: shiftList })`), others return service result directly. The factory uses the service result directly — migrated entities must ensure their service methods return the schema-compliant shape (or the factory needs a `wrapKey` option — see Task 1 notes).
8. **`invites.ts` per-path auth middleware**: `invites.use('/', authMiddleware, requirePermission(...))` uses path-level middleware — the factory mounts per-handler middleware, so `invites.ts` migration must preserve the public routes (`/validate/:code`, `/redeem`) outside the factory entirely.

---

## Task 1: Create `apps/worker/lib/entity-router.ts`

**Files:**
- Create: `apps/worker/lib/entity-router.ts`
- Create: `apps/worker/__tests__/unit/entity-router.test.ts`

### Factory Interface

```typescript
import { Hono } from 'hono'
import { describeRoute, resolver, validator } from 'hono-openapi'
import type { ZodTypeAny } from 'zod'
import type { AppEnv } from '../types'
import type { Services } from '../services'
import { requirePermission } from '../middleware/permission-guard'
import { authErrors, notFoundError } from '../openapi/helpers'
import { audit } from '../services/audit'
import { okResponseSchema } from '@protocol/schemas/common'

interface EntityRouterConfig<
  TList extends ZodTypeAny,
  TItem extends ZodTypeAny,
  TCreate extends ZodTypeAny,
  TUpdate extends ZodTypeAny,
  TListQuery extends ZodTypeAny = ZodTypeAny,
> {
  /** OpenAPI tag string — e.g. 'Shifts', 'Volunteers' */
  tag: string

  /**
   * Permission domain prefix. Factory appends ':read', ':create', ':update', ':delete'.
   * E.g. 'shifts' → 'shifts:read', 'shifts:create', 'shifts:update', 'shifts:delete'
   */
  domain: string

  /** Key of the services object holding the CRUD methods — e.g. 'shifts', 'identity' */
  service: keyof Services

  /** Zod schema for GET list response — passed directly to resolver() */
  listResponseSchema: TList

  /** Zod schema for single-item response (GET /:id, PATCH /:id) */
  itemResponseSchema: TItem

  /** Zod schema for POST body. If omitted, POST / is not registered. */
  createBodySchema?: TCreate

  /** Zod schema for PATCH body. If omitted, PATCH /:id is not registered. */
  updateBodySchema?: TUpdate

  /** Zod schema for GET list query params. If omitted, no query validator is applied. */
  listQuerySchema?: TListQuery

  /**
   * Zod schema for DELETE response. Defaults to okResponseSchema if omitted.
   * Pass itemResponseSchema explicitly when the handler returns the deleted item.
   */
  deleteResponseSchema?: ZodTypeAny

  /**
   * URL param name for single-item endpoints. Default: 'id'.
   * Use 'targetPubkey' for volunteers, 'hubId' for hubs (when id collides with context), 'phone' for bans.
   */
  idParam?: string

  /**
   * Whether to pass hubId as the first argument to service methods.
   * Default: false.
   * When true: service.list(hubId, query?), service.create(hubId, body), service.update(hubId, id, body), service.delete(hubId, id)
   * When false: service.list(query?), service.create(body), service.update(id, body), service.delete(id)
   */
  hubScoped?: boolean

  /** Audit event names for each mutation. If omitted for an operation, no audit event is emitted. */
  auditEvents?: {
    created?: string
    updated?: string
    deleted?: string
  }

  /**
   * Override service method names. Defaults: list, get, create, update, delete
   * Use when service methods differ from the standard names.
   *
   * IMPORTANT: `GET /:id` is only registered when `methods.get` is provided OR
   * `itemResponseSchema` is provided AND `disableGet` is not true.
   * `DELETE /:id` is only registered when `disableDelete` is not true.
   * This matters for list-only factory configs (e.g. invites list, bans list) where
   * the GET /:id and DELETE /:id service methods don't exist — leaving them unset
   * (combined with disableGet/disableDelete) prevents accidental route registration.
   */
  methods?: {
    list?: string
    get?: string
    create?: string
    update?: string
    delete?: string
  }

  /**
   * Set true to prevent registering `GET /:id`. Default: false.
   * Use for list-only factory configs where no single-item fetch is needed.
   */
  disableGet?: boolean

  /**
   * Set true to prevent registering `DELETE /:id`. Default: false.
   * Use when delete is hand-written (e.g. requires URL decoding, custom permission).
   */
  disableDelete?: boolean
}

export function createEntityRouter<
  TList extends ZodTypeAny,
  TItem extends ZodTypeAny,
  TCreate extends ZodTypeAny,
  TUpdate extends ZodTypeAny,
  TListQuery extends ZodTypeAny = ZodTypeAny,
>(config: EntityRouterConfig<TList, TItem, TCreate, TUpdate, TListQuery>): Hono<AppEnv>
```

### Internal arg-building convention

The factory builds service call arguments using this logic — **not** exposed in the public API:

```typescript
// GET / (list)
const args: unknown[] = []
if (config.hubScoped) args.push(c.get('hubId'))
if (query !== undefined) args.push(query)
const result = await (svc[listMethod] as (...a: unknown[]) => Promise<unknown>)(...args)

// GET /:id
const args: unknown[] = []
if (config.hubScoped) args.push(c.get('hubId'))
args.push(id)
const result = await (svc[getMethod] as (...a: unknown[]) => Promise<unknown>)(...args)

// POST /
const args: unknown[] = []
if (config.hubScoped) args.push(c.get('hubId'))
args.push(body)
const result = await (svc[createMethod] as (...a: unknown[]) => Promise<unknown>)(...args)

// PATCH /:id
const args: unknown[] = []
if (config.hubScoped) args.push(c.get('hubId'))
args.push(id, body)
const result = await (svc[updateMethod] as (...a: unknown[]) => Promise<unknown>)(...args)

// DELETE /:id
const args: unknown[] = []
if (config.hubScoped) args.push(c.get('hubId'))
args.push(id)
const result = await (svc[deleteMethod] as (...a: unknown[]) => Promise<unknown>)(...args)
```

The `Function` cast is contained entirely within the factory body — not in the config type, not in any exported surface.

### Unit tests to write in `entity-router.test.ts`

```
- GET / calls service[listMethod] with correct args (hub-scoped vs global)
- GET / applies requirePermission('domain:read')
- GET / uses listQuerySchema validator when provided
- POST / is NOT registered when createBodySchema is omitted
- POST / calls service[createMethod], emits audit event when auditEvents.created is set
- POST / does NOT emit audit event when auditEvents.created is omitted
- PATCH /:id is NOT registered when updateBodySchema is omitted
- GET /:id is NOT registered when disableGet: true
- DELETE /:id is NOT registered when disableDelete: true
- DELETE /:id uses custom idParam when configured
- DELETE /:id emits audit event when auditEvents.deleted is set
- resolver() is called with listResponseSchema directly (not wrapped)
- permissionOverrides.create overrides domain + ':create' when set
```

- [ ] Create `apps/worker/lib/entity-router.ts` implementing the full `createEntityRouter()` factory with all 5 endpoints (GET /, GET /:id, POST /, PATCH /:id, DELETE /:id)
- [ ] Register `GET /` with `describeRoute` using `listResponseSchema`, `requirePermission(domain + ':read')`, optional `listQuerySchema` validator
- [ ] Register `GET /:id` **conditionally** — only when `config.disableGet !== true`. Uses `itemResponseSchema`, `requirePermission(domain + ':read')`, `notFoundError` in responses. This prevents accidental registration in list-only configs where no single-item service method exists.
- [ ] Register `POST /` conditionally (when `createBodySchema` present) with `describeRoute` using `itemResponseSchema` at 201, `requirePermission(domain + ':create')`, `validator('json', createBodySchema)`, audit call when `auditEvents.created` set
- [ ] Register `PATCH /:id` conditionally (when `updateBodySchema` present) with `describeRoute` using `itemResponseSchema` at 200, `requirePermission(domain + ':update')`, `validator('json', updateBodySchema)`, `notFoundError`, audit call when `auditEvents.updated` set
- [ ] Register `DELETE /:id` **conditionally** — only when `config.disableDelete !== true`. Uses `deleteResponseSchema ?? okResponseSchema` at 200, `requirePermission(domain + ':delete')`, `notFoundError`, audit call when `auditEvents.deleted` set. This prevents accidental registration when delete is hand-written (e.g. requires URL decoding or a non-standard permission).
- [ ] Create `apps/worker/__tests__/unit/entity-router.test.ts` with the unit tests listed above
- [ ] Run `bunx tsc --noEmit --project apps/worker/tsconfig.json` (or `bun run typecheck`) — zero errors
- [ ] Run unit tests: `bun test apps/worker/__tests__/unit/entity-router.test.ts`
- [ ] Commit: `git commit -m "feat(worker): add createEntityRouter CRUD factory"`

---

## Task 2: Migrate `shifts.ts` (Priority 1)

**Files:**
- Modify: `apps/worker/routes/shifts.ts`

### What stays hand-written (do NOT touch):
- `GET /my-status` — no `requirePermission`, custom `services.shifts.getMyStatus(hubId, pubkey)` arity
- `GET /fallback` — permission `shifts:manage-fallback`, service `settings.getFallbackGroup`
- `PUT /fallback` — permission `shifts:manage-fallback`, service `settings.setFallbackGroup`

### What the factory covers:
- `GET /` — list shifts
- `POST /` — create shift (with audit `shiftCreated`)
- `PATCH /:id` — update shift (with audit `shiftEdited`) — **IMPORTANT**: current handler has `if (id === 'fallback') return c.json({ error: 'Not Found' }, 404)` guard; Hono route matching means `/fallback` will always match the literal `GET /fallback` route registered earlier, so this guard in PATCH is defensive code only. Keep it as a note; the factory does not need it because named routes take precedence.
- `DELETE /:id` — delete shift (with audit `shiftDeleted`)

**Note on audit detail args**: The current `shifts.ts` passes `{ shiftId: id }` to audit for update/delete. The factory's audit call passes `{}` by default (details are optional). Since the spec says audit detail arguments are optional (`details: Record<string, unknown> = {}`), this is an acceptable simplification — audit events are still emitted with actor and event type. If exact audit detail parity is required, use the `postUpdate`/`postDelete` hook pattern (see below) or keep update/delete hand-written. **Decision: accept the simplification — audit events still fire; shiftId detail is optional metadata.**

**Note on response shape — GET /, POST /, PATCH /:id**: The current handlers wrap service results:
- `GET /`: `return c.json({ shifts: shiftList })` — service returns `Shift[]` raw
- `POST /`: `return c.json({ shift }, 201)` — service returns a single `Shift`
- `PATCH /:id`: `return c.json({ shift })` — service returns a single `Shift`

The factory returns service results **directly** (no wrapping). This is the correct shape per the schemas (`shiftListResponseSchema` is `{ shifts: Shift[] }`, `shiftResponseSchema` is the flat shift object). But there is a behavioral change: POST and PATCH currently respond with `{ shift: {...} }` wrapper, while the factory will respond with `{...}` flat. **Any BDD test or client code asserting on `response.shift.id` instead of `response.id` will break.**

**Actions before deleting the hand-written handlers:**
1. Inspect `services.shifts.list(hubId)` — if it returns `Shift[]`, update it to return `{ shifts: Shift[] }` to match `shiftListResponseSchema`.
2. Inspect `services.shifts.create()` and `services.shifts.update()` — if they return `Shift`, they match `shiftResponseSchema` (flat object). The factory response changes from `{ shift: Shift }` to `Shift`.
3. Search BDD step definitions for `response.shift.` pattern and update to `response.` — do this as part of the same commit to keep tests green.

### Factory config for shifts

```typescript
const shiftCrudRouter = createEntityRouter({
  tag: 'Shifts',
  domain: 'shifts',
  service: 'shifts',
  listResponseSchema: shiftListResponseSchema,
  itemResponseSchema: shiftResponseSchema,
  createBodySchema: createShiftBodySchema,
  updateBodySchema: updateShiftBodySchema,
  deleteResponseSchema: okResponseSchema,
  hubScoped: true,
  auditEvents: {
    created: 'shiftCreated',
    updated: 'shiftEdited',
    deleted: 'shiftDeleted',
  },
})
shifts.route('/', shiftCrudRouter)
```

- [ ] Inspect `apps/worker/services/shifts.ts` — verify `list()`, `create()`, `update()`, `delete()` signatures and return types match the factory's calling convention
- [ ] Verify that `shiftListResponseSchema` matches what `services.shifts.list(hubId)` returns (if service returns `Shift[]` raw but schema expects `{ shifts: Shift[] }`, update the service to return `{ shifts }`)
- [ ] Add factory config and `shifts.route('/', shiftCrudRouter)` to `shifts.ts`
- [ ] Delete the four hand-written CRUD handlers (GET /, POST /, PATCH /:id, DELETE /:id)
- [ ] Preserve `GET /my-status`, `GET /fallback`, `PUT /fallback` exactly as-is
- [ ] Run `bun run typecheck` — zero errors
- [ ] Run `bun run dev:server` — server starts, no runtime errors
- [ ] Run `bun run test:backend:bdd` — all BDD scenarios pass
- [ ] Commit: `git commit -m "refactor(worker/shifts): migrate CRUD to entity-router factory"`

---

## Task 3: Migrate `volunteers.ts` (Priority 2)

**Files:**
- Modify: `apps/worker/routes/volunteers.ts`

### What stays hand-written (do NOT touch):
- `PATCH /:targetPubkey` — has non-trivial side effects: conditional `rolesChanged` vs `volunteerDeactivated` audit events, `revokeAllSessions` call on role/activation change. These cannot be expressed in the factory's single `auditEvents.updated` string.
- `DELETE /:targetPubkey` — has `revokeAllSessions()` pre-delete side effect before the main delete.
- `GET /:targetPubkey/cases` — sub-resource, custom permission `volunteers:read-cases`
- `GET /:targetPubkey/metrics` — sub-resource, custom permission `volunteers:read-metrics`
- `POST /` — has privilege-escalation role validation logic (checking creator can grant requested roles). Cannot be expressed in factory config.

### What the factory covers:
- `GET /` — list volunteers
- `GET /:targetPubkey` — get single volunteer

**Note**: `volunteers.use('*', requirePermission('volunteers:read'))` applies a blanket read guard. After migration, the factory registers its own `requirePermission('volunteers:read')` on GET / and GET /:id, so the blanket middleware is redundant for those. However, **remove the blanket `use('*', ...)` if and only if all remaining hand-written handlers also have individual permission guards.** Inspect each hand-written handler before removing it.

### Factory config for volunteers (list + get only)

```typescript
const volunteerReadRouter = createEntityRouter({
  tag: 'Volunteers',
  domain: 'volunteers',
  service: 'identity',
  listResponseSchema: volunteerListResponseSchema,
  itemResponseSchema: volunteerResponseSchema,
  // No createBodySchema, updateBodySchema — disables POST and PATCH on factory router
  // disableDelete: true — DELETE /:targetPubkey stays hand-written (revokeAllSessions side effect)
  disableDelete: true,
  idParam: 'targetPubkey',
  methods: {
    list: 'getVolunteers',
    get: 'getVolunteer',
  },
})
volunteers.route('/', volunteerReadRouter)
```

- [ ] Inspect `apps/worker/services/identity.ts` — verify `getVolunteers()` and `getVolunteer(pubkey)` signatures
- [ ] Add factory config and `volunteers.route('/', volunteerReadRouter)` to `volunteers.ts`
- [ ] Delete hand-written `GET /` and `GET /:targetPubkey` handlers
- [ ] Verify `volunteers.use('*', requirePermission('volunteers:read'))` — remove only if safe (check all remaining hand-written handlers have their own guards)
- [ ] Preserve `POST /`, `PATCH /:targetPubkey`, `DELETE /:targetPubkey`, `GET /:targetPubkey/cases`, `GET /:targetPubkey/metrics` exactly as-is
- [ ] Run `bun run typecheck` — zero errors
- [ ] Run `bun run test:backend:bdd` — all BDD scenarios pass
- [ ] Commit: `git commit -m "refactor(worker/volunteers): migrate list/get to entity-router factory"`

---

## Task 4: Migrate `invites.ts` (Priority 3)

**Files:**
- Modify: `apps/worker/routes/invites.ts`

### What stays hand-written (do NOT touch):
- `GET /validate/:code` — public route (no auth), rate limiting, different error schemas
- `POST /redeem` — public route, Schnorr signature verification, rate limiting
- `invites.use('/', authMiddleware, requirePermission('invites:read'))` — path-level auth middleware (keep as-is)
- `invites.use('/:code', authMiddleware, requirePermission('invites:read'))` — path-level auth middleware (keep as-is)
- `POST /` — has privilege escalation guard (creator cannot grant roles they don't have). Cannot be expressed in factory config.

### What the factory covers:
- `GET /` — list invites
- `DELETE /:code` — revoke invite (with audit `inviteRevoked`)

**Note on `DELETE /:code`**: The id param is `code`, not `id`. The permission used is `invites:revoke`, not `invites:delete`. Since the factory derives permission as `domain + ':delete'`, and the actual permission is `invites:revoke`, this endpoint **cannot** be expressed via the factory's standard domain suffix. It must stay hand-written.

**Revised scope for invites**: Only `GET /` is factorable. The factory saves ~15 lines.

### Factory config for invites (list only)

```typescript
const inviteListRouter = createEntityRouter({
  tag: 'Invites',
  domain: 'invites',
  service: 'identity',
  listResponseSchema: inviteListResponseSchema,
  itemResponseSchema: inviteResponseSchema,
  // No createBodySchema — disables POST
  // disableGet: true — no single-item GET /:code endpoint in invites
  // disableDelete: true — DELETE /:code stays hand-written (non-standard permission: invites:revoke)
  disableGet: true,
  disableDelete: true,
  methods: {
    list: 'getInvites',
  },
})
invites.route('/', inviteListRouter)
```

- [ ] Inspect `apps/worker/services/identity.ts` — verify `getInvites()` signature
- [ ] Add factory config and `invites.route('/', inviteListRouter)` to `invites.ts`
- [ ] Delete hand-written `GET /` handler only
- [ ] Preserve all other endpoints (public routes, POST /, DELETE /:code) exactly as-is
- [ ] Run `bun run typecheck` — zero errors
- [ ] Run `bun run test:backend:bdd` — all BDD scenarios pass
- [ ] Commit: `git commit -m "refactor(worker/invites): migrate list to entity-router factory"`

---

## Task 5: Migrate `audit.ts` (Priority 4)

**Files:**
- Modify: `apps/worker/routes/audit.ts`

### What the factory covers:
- `GET /` — list audit entries with query params

**Note on audit list calling convention**: Current handler passes a manually constructed object to `services.audit.list(hubId, { actorPubkey, eventType, dateFrom, dateTo, search, limit, offset: (query.page - 1) * query.limit })`. The factory passes `(hubId, query)` directly when `hubScoped: true` and `listQuerySchema` is provided. The `audit` service's `list()` method must accept the query object directly — inspect whether offset calculation is done in the route or in the service. If done in the route (it is, currently), the service must be updated to accept `{ page, limit, ... }` and compute offset internally, OR the `GET /` stays hand-written.

**Decision**: Update `services.audit.list()` to accept `page` (instead of `offset`) and compute `offset = (page - 1) * limit` internally. This is a minor service change that aligns with the factory convention. Verify no other callers of `services.audit.list()` pass `offset` directly.

### Factory config for audit

```typescript
const auditCrudRouter = createEntityRouter({
  tag: 'Audit',
  domain: 'audit',
  service: 'audit',
  listResponseSchema: auditListResponseSchema,
  itemResponseSchema: auditListResponseSchema, // no single-item GET in audit
  listQuerySchema: listAuditQuerySchema,
  hubScoped: true,
  methods: {
    list: 'list',
  },
})
// Re-export as the entire audit router
export default auditCrudRouter
```

**Note**: `auditRoutes.use('*', requirePermission('audit:read'))` currently provides a blanket guard. After migration to the factory, the factory registers `requirePermission('audit:read')` on `GET /` directly. Remove the blanket middleware.

- [ ] Inspect `apps/worker/services/audit.ts` `list()` signature — check whether offset calculation belongs in service or route
- [ ] If needed, update `AuditService.list()` to accept `page` and compute `offset` internally; ensure no other callers break
- [ ] Replace `audit.ts` with factory config
- [ ] Remove blanket `auditRoutes.use('*', requirePermission('audit:read'))`
- [ ] Run `bun run typecheck` — zero errors
- [ ] Run `bun run test:backend:bdd` — all BDD scenarios pass
- [ ] Commit: `git commit -m "refactor(worker/audit): migrate list to entity-router factory"`

---

## Task 6: Migrate `bans.ts` (Priority 5)

**Files:**
- Modify: `apps/worker/routes/bans.ts`

### What stays hand-written (do NOT touch):
- `POST /bulk` — custom action, custom permission `bans:bulk-create`, custom response schema `bulkBanResponseSchema`
- `POST /` — has E.164 phone number validation side effect before the service call. Cannot be expressed purely in factory config.
- `DELETE /:phone` — has `decodeURIComponent(c.req.param('phone'))` URL decoding; the factory passes `c.req.param(idParam)` directly without decoding. This is a meaningful behavioral difference — keep hand-written.

### What the factory covers:
- `GET /` — list bans

**Revised scope for bans**: Only `GET /` is cleanly factorable. POST, DELETE both have side effects or URL decoding that differ from the factory's standard behavior.

### Factory config for bans (list only)

```typescript
const banListRouter = createEntityRouter({
  tag: 'Bans',
  domain: 'bans',
  service: 'records',
  listResponseSchema: banListResponseSchema,
  itemResponseSchema: banListResponseSchema, // no single-item GET
  hubScoped: true,
  // disableGet: true — no single-item GET /:phone endpoint in bans
  // disableDelete: true — DELETE /:phone stays hand-written (decodeURIComponent on param)
  disableGet: true,
  disableDelete: true,
  methods: {
    list: 'listBans',
  },
})
bans.route('/', banListRouter)
```

- [ ] Inspect `apps/worker/services/records.ts` — verify `listBans(hubId)` signature
- [ ] Add factory config and `bans.route('/', banListRouter)` to `bans.ts`
- [ ] Delete hand-written `GET /` handler
- [ ] Preserve `POST /`, `POST /bulk`, `DELETE /:phone` exactly as-is
- [ ] Run `bun run typecheck` — zero errors
- [ ] Run `bun run test:backend:bdd` — all BDD scenarios pass
- [ ] Commit: `git commit -m "refactor(worker/bans): migrate list to entity-router factory"`

---

## Task 7: Migrate `hubs.ts` (Priority 6)

**Files:**
- Modify: `apps/worker/routes/hubs.ts`

### What stays hand-written (do NOT touch):
- `GET /` — has complex filtering logic (super admin sees all vs member-filtered). Cannot be expressed in factory config.
- `GET /:hubId` — has access control check (isSuperAdmin OR hasHubAccess) beyond simple permission guard.
- `POST /` — has inline `Hub` object construction with `crypto.randomUUID()`, slug generation, try/catch error mapping. Cannot be expressed in factory config.
- `PATCH /:hubId` — has try/catch error mapping. Marginally factorable but the error mapping difference makes it non-trivial.
- `POST /:hubId/members` — sub-resource, different permission `hubs:manage-members`
- `DELETE /:hubId/members/:pubkey` — sub-resource
- `GET /:hubId/key` — sub-resource
- `PUT /:hubId/key` — sub-resource

**Revised scope for hubs**: None of the hubs CRUD endpoints are cleanly factorable due to access-control layering and inline business logic. Skip this entity in the migration.

- [ ] Document the decision in a code comment at the top of `hubs.ts`: "Hub routes are not migrated to the entity-router factory — access control and hub construction logic cannot be expressed in factory config."
- [ ] No code changes to route handlers
- [ ] Commit: `git commit -m "docs(worker/hubs): note factory migration not applicable"`

---

## Task 8: Migrate entity types sub-section in `entity-schema.ts` (Priority 7)

**Files:**
- Modify: `apps/worker/routes/entity-schema.ts`

### What stays hand-written (do NOT touch):
- `GET /case-management`, `PUT /case-management` — toggle endpoint, not CRUD
- `GET /auto-assignment`, `PUT /auto-assignment` — toggle endpoint
- `GET /cross-hub`, `PUT /cross-hub` — toggle endpoint
- `GET /entity-types` — uses `requireAnyPermission(...)` (OR logic), not compatible with factory's single `domain` prefix
- `POST /templates/apply` — complex transaction (load template, merge, bulk-set multiple entity types, audit)
- `GET /templates`, `GET /templates/:id`, `GET /templates/updates` — read-only template catalog, not entity CRUD
- `POST /roles/from-template` — complex multi-step role creation
- `POST /case-number` — compute endpoint, not CRUD
- All relationship types GET and POST with `requireAnyPermission` patterns
- All CMS report types GET endpoint (uses `settings:read` not `cases:manage-types:read`)

### What the factory covers:
- `POST /entity-types` — create (permission `cases:manage-types:create` — wait, current permission is `cases:manage-types`, not `cases-entity-types:create`). The factory derives `domain + ':create'`, so `domain: 'cases-entity-types'` would produce `cases-entity-types:create`. But the real permission is `cases:manage-types`. **This means POST/PATCH/DELETE for entity-types are NOT factorable** via the standard domain suffix. Skip factory migration for entity-schema.ts.

**Revised scope for entity-schema.ts**: The permission naming for entity-schema CMS operations (`cases:manage-types` instead of a standard `entity-types:create`) is incompatible with the factory's `domain + ':suffix'` convention. None of the entity-types, relationship-types, or report-types CRUD in `entity-schema.ts` are migratable without either (a) renaming permissions (a separate breaking change), or (b) adding a `permissions` override config to the factory.

**Option**: Add `permissionOverrides` to the factory config so each operation's permission can be overridden individually:

```typescript
permissionOverrides?: {
  list?: string
  get?: string
  create?: string
  update?: string
  delete?: string
}
```

When `permissionOverrides.create` is set, use that instead of `domain + ':create'`.

- [ ] Add `permissionOverrides` option to `EntityRouterConfig` in `entity-router.ts` (update Task 1's factory to support this)
- [ ] Update factory body to use `config.permissionOverrides?.list ?? (config.domain + ':read')` pattern for each endpoint
- [ ] Update unit tests to cover `permissionOverrides` behavior
- [ ] For `entity-schema.ts`, migrate `POST /entity-types`, `PATCH /entity-types/:id`, `DELETE /entity-types/:id` using:

```typescript
const entityTypeRouter = createEntityRouter({
  tag: 'Case Management',
  domain: 'cases-entity-types',
  service: 'settings',
  listResponseSchema: entityTypeListResponseSchema,
  itemResponseSchema: entityTypeDefinitionSchema,
  createBodySchema: createEntityTypeBodySchema,
  updateBodySchema: updateEntityTypeBodySchema,
  permissionOverrides: {
    list: 'cases:manage-types',   // not used (GET stays hand-written due to requireAnyPermission)
    create: 'cases:manage-types',
    update: 'cases:manage-types',
    delete: 'cases:manage-types',
  },
  methods: {
    list: 'getEntityTypes',
    create: 'createEntityType',
    update: 'updateEntityType',
    delete: 'deleteEntityType',
  },
  auditEvents: {
    created: 'entityTypeCreated',
    updated: 'entityTypeUpdated',
    deleted: 'entityTypeDeleted',
  },
})
entitySchema.route('/entity-types', entityTypeRouter)
```

Note: `GET /entity-types` stays hand-written (uses `requireAnyPermission`). The factory router registered at `/entity-types` only handles POST, PATCH /:id, DELETE /:id.

- [ ] Migrate `POST /relationship-types`, `PATCH /relationship-types/:id`, `DELETE /relationship-types/:id` similarly
- [ ] Migrate `POST /report-types`, `GET /report-types/:id`, `PATCH /report-types/:id`, `DELETE /report-types/:id` similarly (GET /report-types list stays hand-written, uses `settings:read`)
- [ ] Run `bun run typecheck` — zero errors
- [ ] Run `bun run test:backend:bdd` — all BDD scenarios pass
- [ ] Commit: `git commit -m "refactor(worker/entity-schema): migrate CMS type CRUD to entity-router factory"`

---

## Task 9: Verification and Line Count Check

**Files:** None created/modified — verification only.

- [ ] Run full verification suite:

```bash
# Type check
bun run typecheck

# Line count comparison (before vs after — compare to git stash or log)
wc -l apps/worker/routes/shifts.ts apps/worker/routes/volunteers.ts \
  apps/worker/routes/invites.ts apps/worker/routes/audit.ts \
  apps/worker/routes/bans.ts apps/worker/routes/entity-schema.ts

# OpenAPI snapshot integrity check
# Start dev server, capture snapshot, diff against committed version
ENVIRONMENT=development bun run dev:server &
DEV_PID=$!
sleep 4
curl -s http://localhost:3000/api/openapi.json > /tmp/openapi-live.json
diff packages/protocol/openapi-snapshot.json /tmp/openapi-live.json
kill $DEV_PID

# BDD tests
bun run test:backend:bdd

# Playwright E2E
bun run test
```

- [ ] Confirm total line count of migrated route files is at least 40% lower than pre-migration (compare `git diff --stat HEAD~8..HEAD apps/worker/routes/`)
- [ ] Confirm `packages/protocol/openapi-snapshot.json` diff is empty (or only whitespace)
- [ ] Confirm no `Function` type or `as any` appears outside `entity-router.ts` internals: `grep -n 'as any\|as Function' apps/worker/routes/*.ts` returns zero results
- [ ] Commit: `git commit -m "chore(worker): verify api-surface-simplification migration complete"`

---

## Task 10: Add `apps/worker/lib/entity-router.ts` to worker tsconfig paths (if needed)

**Files:**
- Possibly modify: `apps/worker/tsconfig.json`

- [ ] Verify that `@worker/lib/entity-router` resolves correctly via the existing `@worker/*` tsconfig path alias (check `tsconfig.json` for `paths` config)
- [ ] If the `@worker/*` alias is not configured for internal worker imports, update `apps/worker/tsconfig.json` accordingly
- [ ] Run `bun run typecheck` — zero errors
- [ ] Commit (if changes made): `git commit -m "chore(worker): add entity-router to tsconfig paths"`

---

## Summary: What Gets Migrated vs What Stays Hand-Written

| Route file | Factory covers | Stays hand-written |
|------------|---------------|-------------------|
| `shifts.ts` | GET /, POST /, PATCH /:id, DELETE /:id | GET /my-status, GET /fallback, PUT /fallback |
| `volunteers.ts` | GET /, GET /:targetPubkey | POST /, PATCH /:targetPubkey, DELETE /:targetPubkey, sub-resources |
| `invites.ts` | GET / | Public routes, POST /, DELETE /:code (non-standard permission) |
| `audit.ts` | GET / | Nothing — entire file becomes factory |
| `bans.ts` | GET / | POST / (E.164 validation), POST /bulk, DELETE /:phone (URL decoding) |
| `hubs.ts` | Nothing | All (access control too complex for factory) |
| `entity-schema.ts` | POST/PATCH/DELETE for entity-types, relationship-types, report-types | Toggle endpoints, GET lists with requireAnyPermission, templates, roles-from-template |

## Decisions That Require Care

1. **Service return shape alignment** (Task 2): Before using the factory for shifts, verify `services.shifts.list(hubId)` returns `{ shifts: Shift[] }` (matching `shiftListResponseSchema`), not a raw array. Same for volunteers' `getVolunteers()`. The factory returns service results directly — no wrapping.

2. **`audit.ts` offset computation** (Task 5): Move `(page - 1) * limit` computation from route handler into `AuditService.list()`. Verify no other callers pass raw `offset` values.

3. **`permissionOverrides` addition** (Task 8): This is an additive, backward-compatible change to the factory interface. Add it during Task 8, not retroactively.

4. **OpenAPI snapshot**: After each migration commit, regenerate and diff the snapshot. Any divergence in `operationId`, summary text, or schema references must be fixed before proceeding to the next entity.
