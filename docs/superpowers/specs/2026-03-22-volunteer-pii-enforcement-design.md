# Volunteer PII Enforcement — Design Spec

**Date:** 2026-03-22
**Status:** Draft

## Problem

Volunteer records contain PII fields (`name`, `phone`, `email`) that must only be visible based on role. The data classification document (`docs/security/DATA_CLASSIFICATION.md`) classifies these as "Encrypted-at-Rest" but the API filtering is ad-hoc: some endpoints may return these fields to volunteers who shouldn't see them.

The current code uses informal `if (role === 'admin')` checks scattered through route handlers rather than a type-enforced projection layer. This means:
1. A code change can accidentally include a PII field in a non-admin response.
2. TypeScript does not catch it — the return type is too broad.
3. There's no audit of which endpoints expose PII.

## Goals

1. Define three distinct TypeScript types for volunteer data at different privilege levels.
2. A single projection function produces the correct type for a given caller's role.
3. TypeScript makes it impossible to accidentally return an admin-only field to a volunteer.
4. Phone number viewing requires an additional `?unmask=true` query param plus an active admin session (for the admin's own use; normal admin responses return masked phone).
5. All `GET /api/volunteers*` endpoints pass through the projector.

## Non-Goals

- Encrypting name/phone/email E2EE client-side (that would require key distribution to all admins; current "Encrypted-at-Rest" classification is accepted).
- Changing what data is stored — only what is returned in API responses.

## Three Privilege Levels

```typescript
// What any authenticated volunteer can see about another volunteer:
interface VolunteerPublicView {
  readonly view: 'public'
  pubkey: string
  roles: Role[]
  active: boolean
  lastSeen: Date | null
  // No name, no phone, no email
}

// What a volunteer can see about themselves:
interface VolunteerSelfView {
  readonly view: 'self'
  pubkey: string
  roles: Role[]
  active: boolean
  lastSeen: Date | null
  name: string
  spokenLanguages: string[]
  email?: string
  phone: string   // always masked: "+1 *** *** 1234"
}

// What an admin can see about any volunteer:
interface VolunteerAdminView {
  readonly view: 'admin'
  pubkey: string
  roles: Role[]
  active: boolean
  lastSeen: Date | null
  name: string
  spokenLanguages: string[]
  email?: string
  phone: string   // masked by default; full number with ?unmask=true
  createdAt: Date
  webauthnCredentials: { id: string, deviceName?: string, createdAt: Date }[]
  // No raw session tokens
}
```

## Projection Function

```typescript
function projectVolunteer(
  record: VolunteerRecord,
  viewer: { pubkey: string; roles: Role[] },
  options?: { unmask?: boolean }
): VolunteerPublicView | VolunteerSelfView | VolunteerAdminView
```

- `isAdmin(viewer)` → `VolunteerAdminView` (phone masked unless `options.unmask && isAdmin`)
- `viewer.pubkey === record.pubkey` → `VolunteerSelfView`
- otherwise → `VolunteerPublicView`

The return type is a discriminated union on the `view` field. TypeScript prevents accessing admin-only fields without first narrowing via `if (v.view === 'admin')`. For example:

```typescript
const v = projectVolunteer(record, viewer)
// v.createdAt  // TS error: property does not exist on VolunteerPublicView | VolunteerSelfView
if (v.view === 'admin') {
  v.createdAt   // OK — TypeScript has narrowed to VolunteerAdminView
}
```

## Phone Masking

```typescript
function maskPhone(phone: string): string {
  // E.164 format assumed (e.g. "+14155551234", "+447911123456")
  // Keeps the country code prefix (1–3 digits after "+") and last 4 digits.
  // Works correctly for NANP (+1), EU two-digit (+44, +49), and three-digit (+353) codes.
  const last4 = phone.slice(-4)
  // Extract country code: strip leading "+", take up to the first 3 chars, then re-add "+"
  // For +1 NANP numbers the prefix is "+1"; for +44 it is "+44"; for +353 it is "+35"
  // The safe heuristic: keep phone.slice(0, 3) which covers "+X" and "+XX" country codes,
  // then mask everything in between.
  const prefix = phone.slice(0, 3)   // e.g. "+14", "+44", "+35"
  return `${prefix} *** *** ${last4}`
}
```

For display purposes this format is sufficient — the masked middle conveys that digits are hidden without exposing national-subscriber-number length. The full E.164 string is only returned to admins with `?unmask=true`.

Full number (`unmask=true`): Only available to admins, only on `GET /api/volunteers/:pubkey?unmask=true`. Audit log entry created on every unmask request.

## Affected Endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /api/volunteers` | `VolunteerPublicView[]` for volunteers; `VolunteerAdminView[]` for admins |
| `GET /api/volunteers/:pubkey` | Self → `VolunteerSelfView`; Admin → `VolunteerAdminView`; Other → `VolunteerPublicView` |
| `GET /api/volunteers/:pubkey?unmask=true` | Admin only → `VolunteerAdminView` with full phone; audit logged |
| `GET /api/auth/me` | `VolunteerSelfView` (always self) |
| `PATCH /api/volunteers/me` | Returns `VolunteerSelfView` |
| `PATCH /api/volunteers/:targetPubkey` | Admin updating another volunteer — returns `VolunteerAdminView` |

## Implementation Strategy

1. Define the three interfaces in `src/worker/lib/volunteer-projector.ts` — these are server-side projection types and do not need to be exported to the client. They must **not** go in `src/shared/types.ts`, which is reserved for types shared across the client/server boundary.
2. Implement `projectVolunteer()` and `maskPhone()` in `src/worker/lib/volunteer-projector.ts` alongside the interface definitions
3. Update all volunteer-returning route handlers to pass through `projectVolunteer()`
4. Remove any ad-hoc `if (admin)` field filtering in route handlers
5. Run `bun run typecheck` — TypeScript must fail if any handler returns `VolunteerRecord` directly

## Testing

- `GET /api/volunteers` as volunteer → response objects have no `phone`, `email`, `createdAt`
- `GET /api/volunteers/:pubkey` (self) → includes `name`, masked phone
- `GET /api/volunteers/:pubkey` (admin) → includes `name`, masked phone, `createdAt`, credentials
- `GET /api/volunteers/:pubkey?unmask=true` (admin) → full phone number
- `GET /api/volunteers/:pubkey?unmask=true` (volunteer) → 403
- Unmask request creates audit log entry
