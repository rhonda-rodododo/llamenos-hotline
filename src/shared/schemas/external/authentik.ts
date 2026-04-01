import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Authentik IdP REST API Response Schemas
//
// Authentik exposes a versioned REST API at /api/v3/. Responses are JSON.
// Schema reference: https://api.goauthentik.io/schema.yml
// Instance API browser: https://<your-authentik>/api/v3/
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Generic paginated list wrapper
// All list endpoints return this envelope around the typed results array.
// ---------------------------------------------------------------------------

/**
 * Build a typed paginated list schema for any result type.
 * Authentik uses Django REST Framework's standard pagination format.
 */
export function authentikPaginatedList<T extends z.ZodTypeAny>(resultSchema: T) {
  return z.object({
    count: z.number().int(),
    /** URL to the next page, or null if this is the last page */
    next: z.string().url().nullable(),
    /** URL to the previous page, or null if this is the first page */
    previous: z.string().url().nullable(),
    results: z.array(resultSchema),
  })
}

// ---------------------------------------------------------------------------
// User object
// Returned by GET /api/v3/core/users/ and GET /api/v3/core/users/{id}/
// ---------------------------------------------------------------------------

export const AuthentikUserSchema = z.looseObject({
  /** Database primary key */
  pk: z.number().int(),
  username: z.string(),
  /** Display name (may differ from username) */
  name: z.string(),
  /** Email address */
  email: z.string().optional(),
  is_active: z.boolean(),
  /** Whether the user has staff/superuser access in authentik */
  is_staff: z.boolean().optional(),
  /** Hierarchical path for organisational grouping (e.g. "users/volunteers") */
  path: z.string(),
  /**
   * Arbitrary key-value attributes.
   * Values may be strings, numbers, booleans, or nested objects in practice;
   * the schema accepts unknown values.
   */
  attributes: z.record(z.string(), z.unknown()),
  /** UUIDs or names of groups this user directly belongs to */
  groups: z.array(z.string()),
  /** Opaque unique ID (UUID4) — stable across username changes */
  uid: z.string().optional(),
  /** ISO 8601 datetime of account creation */
  date_joined: z.string().optional(),
  /** ISO 8601 datetime of last password change */
  password_change_date: z.string().optional(),
  /** URL to the user's avatar image */
  avatar: z.string().optional(),
  /** Whether the user's credentials are managed by an external source */
  is_superuser: z.boolean().optional(),
  type: z.string().optional(),
})

export type AuthentikUser = z.infer<typeof AuthentikUserSchema>

export const AuthentikPaginatedUserListSchema = authentikPaginatedList(AuthentikUserSchema)
export type AuthentikPaginatedUserList = z.infer<typeof AuthentikPaginatedUserListSchema>

// ---------------------------------------------------------------------------
// Group object
// ---------------------------------------------------------------------------

export const AuthentikGroupSchema = z.looseObject({
  pk: z.string(), // UUID
  name: z.string(),
  is_superuser: z.boolean().optional(),
  parent: z.string().nullable().optional(), // UUID of parent group
  attributes: z.record(z.string(), z.unknown()).optional(),
  users: z.array(z.number().int()).optional(),
  users_obj: z.array(AuthentikUserSchema).optional(),
})

export type AuthentikGroup = z.infer<typeof AuthentikGroupSchema>

// ---------------------------------------------------------------------------
// Invitation object
// Returned by GET /api/v3/stages/invitation/invitations/{invite_uuid}/
// ---------------------------------------------------------------------------

export const AuthentikInvitationSchema = z.looseObject({
  /** UUID of the invitation */
  pk: z.string(),
  /** Human-readable label for this invitation */
  name: z.string(),
  /** ISO 8601 datetime after which this invitation is invalid, or null */
  expires: z.string().nullable(),
  /** Slug of the enrollment flow this invitation is tied to */
  flow_slug: z.string().optional(),
  /** If true, this invitation can only be used once */
  single_use: z.boolean(),
  /** ISO 8601 datetime when the invitation was created */
  created: z.string().optional(),
  /** UUID of the user who created this invitation */
  created_by: z.string().nullable().optional(),
})

export type AuthentikInvitation = z.infer<typeof AuthentikInvitationSchema>

// ---------------------------------------------------------------------------
// OAuth2 / OIDC token response
// Returned by POST /application/o/token/ (the token endpoint)
// ---------------------------------------------------------------------------

export const AuthentikTokenResponseSchema = z.looseObject({
  access_token: z.string(),
  token_type: z.string(),
  /** Seconds until the access token expires */
  expires_in: z.number().int(),
  refresh_token: z.string().optional(),
  /** Space-separated list of granted scopes */
  scope: z.string().optional(),
  id_token: z.string().optional(),
})

export type AuthentikTokenResponse = z.infer<typeof AuthentikTokenResponseSchema>

// ---------------------------------------------------------------------------
// Error responses
// Authentik returns errors in one of two shapes depending on the error type.
// ---------------------------------------------------------------------------

/** Field-level validation error (Django REST Framework format) */
export const AuthentikFieldErrorSchema = z.looseObject({
  non_field_errors: z.array(z.string()).optional(),
  detail: z.string().optional(),
})

/** Generic API error */
export const AuthentikDetailErrorSchema = z.object({
  detail: z.string(),
})

/** Union of both error shapes */
export const AuthentikErrorSchema = z.union([AuthentikDetailErrorSchema, AuthentikFieldErrorSchema])

export type AuthentikFieldError = z.infer<typeof AuthentikFieldErrorSchema>
export type AuthentikDetailError = z.infer<typeof AuthentikDetailErrorSchema>
export type AuthentikError = z.infer<typeof AuthentikErrorSchema>
