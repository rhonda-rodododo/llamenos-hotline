---
name: api-schema-dev
description: Guide full-stack feature development with zod-validated schemas and OpenAPI-documented endpoints. Use this skill for ANY feature work that touches API endpoints, data types, or encrypted fields — including frontend components that consume API data. Trigger when adding new API endpoints, modifying route handlers, creating React Query hooks, building forms that submit to the API, working with encrypted fields (hub-key or envelope), creating or editing zod schemas, converting routes to @hono/zod-openapi, or adding new resource entities. Also trigger when the user mentions API validation, OpenAPI, Scalar docs, zod schemas, request/response types, shared types, or type duplication. This skill enforces the schema-first, single-source-of-truth pattern where all types are derived from zod schemas in @shared/schemas/ and used by both backend and frontend — no duplicate type definitions.
---

# API Schema Development

This skill guides you through adding validated, documented API routes to the Llamenos project. Every API endpoint should have:
- **Zod schemas** in `src/shared/schemas/` as the single source of truth for types
- **Declarative route definitions** using `@hono/zod-openapi`'s `createRoute()`
- **Runtime validation** via `c.req.valid('json')` / `c.req.valid('param')`
- **Auto-generated OpenAPI docs** visible at `/api/docs` (Scalar UI)

## When This Is Significant Work

Adding a new resource/entity (new route file, new DB table, new schemas) is significant work. Per CLAUDE.md, the superpowers brainstorming → planning → implementation workflow is mandatory. This skill covers the implementation phase — invoke brainstorming and writing-plans first for new entities.

For smaller changes (adding a field to an existing schema, fixing validation), skip straight to implementation.

## The Schema-First Pattern

Types flow in ONE direction: **zod schema → TypeScript type → everywhere**.

```
src/shared/schemas/entity.ts     ← Define schemas here (single source of truth)
  ├── export type Entity = z.infer<typeof EntitySchema>
  ├── export type CreateEntityInput = z.infer<typeof CreateEntitySchema>
  └── export type UpdateEntityInput = z.infer<typeof UpdateEntitySchema>

src/server/routes/entity.ts      ← Import schemas for createRoute() + validation
src/server/services/entity.ts    ← Import types for service method signatures
src/client/lib/api.ts            ← Import types for API call signatures
src/client/components/*.tsx       ← Import types for component props
```

Never define the same type in two places. If you find a type in `src/shared/types.ts` that duplicates a schema-derived type, delete the duplicate and re-export from the schema.

## Step-by-Step: Adding a New API Resource

### 1. Create Schemas (`src/shared/schemas/<entity>.ts`)

Every entity needs at minimum:
- **EntitySchema** — the full read model (what GET returns)
- **CreateEntitySchema** — what POST accepts
- **UpdateEntitySchema** — what PATCH accepts (all fields optional)

```typescript
// src/shared/schemas/widgets.ts
import { z } from 'zod/v4'

// Full entity (read model — returned by GET endpoints)
export const WidgetSchema = z.object({
  id: z.string(),
  hubId: z.string(),
  name: z.string(),
  encryptedName: z.string().optional(),
  status: z.enum(['active', 'archived']),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Widget = z.infer<typeof WidgetSchema>

// Create input (POST body)
export const CreateWidgetSchema = z.object({
  name: z.string().min(1).max(200),
  encryptedName: z.string().optional(),    // Hub-key encrypted; see encrypted fields below
  status: z.enum(['active', 'archived']).default('active'),
})
export type CreateWidgetInput = z.infer<typeof CreateWidgetSchema>

// Update input (PATCH body — all optional)
export const UpdateWidgetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  encryptedName: z.string().optional(),
  status: z.enum(['active', 'archived']).optional(),
})
export type UpdateWidgetInput = z.infer<typeof UpdateWidgetSchema>
```

Then add to `src/shared/schemas/index.ts`:
```typescript
export * from './widgets'
```

### 2. Create the Route File (`src/server/routes/<entity>.ts`)

Use `OpenAPIHono` and `createRoute()` for declarative route definitions:

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { CreateWidgetSchema, UpdateWidgetSchema, WidgetSchema } from '@shared/schemas/widgets'
import { requirePermission } from '../middleware/permission-guard'
import type { AppEnv } from '../types'

const widgetRoutes = new OpenAPIHono<AppEnv>()

// Path parameter schema (needs .openapi() for OpenAPI metadata)
const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'wgt-abc123' }),
})

// ── GET / ──
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Widgets'],
  summary: 'List widgets',
  responses: {
    200: {
      description: 'Widget list',
      content: {
        'application/json': {
          schema: z.object({ widgets: z.array(WidgetSchema) }),
        },
      },
    },
  },
})

widgetRoutes.openapi(listRoute, async (c) => {
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const widgets = await services.widgets.list(hubId)
  return c.json({ widgets }, 200)
})

// ── POST / ──
const createRouteDefn = createRoute({
  method: 'post',
  path: '/',
  tags: ['Widgets'],
  summary: 'Create a widget',
  middleware: [requirePermission('widgets:create')],
  request: {
    body: {
      content: { 'application/json': { schema: CreateWidgetSchema } },
    },
  },
  responses: {
    201: {
      description: 'Widget created',
      content: { 'application/json': { schema: z.object({ widget: WidgetSchema }) } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
})

widgetRoutes.openapi(createRouteDefn, async (c) => {
  const body = c.req.valid('json')          // ← Validated by zod automatically
  const services = c.get('services')
  const hubId = c.get('hubId') ?? 'global'
  const widget = await services.widgets.create(hubId, body)
  return c.json({ widget }, 201)
})
```

### 3. Wire into `app.ts`

Mount the route on the `authenticated` and `hubScoped` routers:

```typescript
import widgetRoutes from './routes/widgets'

// In the authenticated block:
authenticated.route('/widgets', widgetRoutes)

// In the hubScoped block (if hub-scoped):
hubScoped.route('/widgets', widgetRoutes)
```

The `authenticated` and `hubScoped` routers are `OpenAPIHono` instances, so routes registered with `.openapi()` will appear in the generated OpenAPI spec at `/api/openapi.json` and the Scalar docs at `/api/docs`.

### 4. Update Client API (`src/client/lib/api.ts`)

Import types from the shared schemas — don't redefine them:

```typescript
import type { Widget, CreateWidgetInput } from '@shared/schemas/widgets'

export async function listWidgets() {
  return request<{ widgets: Widget[] }>(hp('/widgets'))
}

export async function createWidget(data: CreateWidgetInput) {
  return request<{ widget: Widget }>(hp('/widgets'), {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
```

### 5. Add Query Key + Classify

In `src/client/lib/queries/keys.ts`, add the query key domain:
```typescript
widgets: {
  all: ['widgets'] as const,
  list: () => ['widgets', 'list'] as const,
},
```

Then in `src/client/lib/query-client.ts`, classify it in either `ENCRYPTED_QUERY_KEYS` or `PLAINTEXT_QUERY_KEYS`. If ANY field is encrypted, it goes in `ENCRYPTED_QUERY_KEYS`. The compile-time `MissingDomains` check will error if you forget.

## Encrypted Fields

Hub-key encrypted fields follow a specific pattern. The codebase has three encryption tiers:

1. **Envelope-encrypted PII** (user names, phones) — per-user ECIES wrapping
2. **Hub-key encrypted org metadata** (role names, shift names, etc.) — symmetric XChaCha20 with hub key
3. **Per-note forward secrecy** — unique random key per note

For hub-key tier fields:

**In schemas**: Use `z.string().optional()` for encrypted fields. The `Ciphertext` branded type is for service layer type safety, not zod validation:
```typescript
export const CreateWidgetSchema = z.object({
  name: z.string().min(1),
  encryptedName: z.string().optional(),    // Client encrypts when hub key available
})
```

**In server create methods**: Always fall back to plaintext:
```typescript
const encryptedName = (data.encryptedName ?? data.name) as Ciphertext
```

**In server update methods**: Fall back to plaintext when encrypted version missing:
```typescript
if (data.encryptedName !== undefined) {
  encFields.encryptedName = data.encryptedName
} else if (data.name !== undefined) {
  encFields.encryptedName = data.name as Ciphertext
}
```

**In client queryFn**: Decrypt in the React Query queryFn, not in components:
```typescript
queryFn: async () => {
  const { widgets } = await listWidgets()
  return widgets.map((w) => ({
    ...w,
    name: decryptHubField(w.encryptedName, hubId, w.name),
  }))
}
```

**In client mutations**: Send both plaintext and encrypted:
```typescript
createWidget({
  name: value,
  encryptedName: encryptHubField(value, hubId),  // undefined if hub key not loaded
})
```

**Query cache invalidation**: If calling API functions directly (not through React Query mutations), always invalidate the query cache:
```typescript
void queryClient.invalidateQueries({ queryKey: queryKeys.widgets.all })
```

## Response Schema Alignment

The `@hono/zod-openapi` library enforces that handler return types match the response schema. If your service returns `Date` objects but the schema says `z.string()`, you'll get a type error.

Solutions:
- Use `z.coerce.string()` for dates that the JSON serializer converts to strings
- Make sure the EntitySchema matches what `JSON.stringify(serviceResult)` produces
- Check service return types before writing the response schema

## Canonical Example

The fully converted reference is `src/server/routes/report-types.ts` with schemas in `src/shared/schemas/report-types.ts`. Read these files to see the complete pattern in action.

## Checklist

Before you're done with a new API resource:

- [ ] Schemas in `src/shared/schemas/<entity>.ts` (Entity, Create, Update)
- [ ] Types exported via `z.infer<>` (not defined separately)
- [ ] Re-exported from `src/shared/schemas/index.ts`
- [ ] Route file uses `OpenAPIHono` + `createRoute()` + `c.req.valid()`
- [ ] Mounted on both `authenticated` and `hubScoped` routers in `app.ts`
- [ ] Client API imports types from `@shared/schemas/` (no duplicates)
- [ ] Query key added + classified in `ENCRYPTED_QUERY_KEYS` or `PLAINTEXT_QUERY_KEYS`
- [ ] Encrypted fields have plaintext fallback in server create/update
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] Tests written (use `test-writer` skill)
