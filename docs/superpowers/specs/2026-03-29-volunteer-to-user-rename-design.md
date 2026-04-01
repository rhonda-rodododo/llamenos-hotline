# Volunteer → User Identity Rename — Design Spec

**Date:** 2026-03-29
**Status:** Draft
**Scope:** Mechanical rename of the identity concept from "volunteer" to "user" across DB schema, server, client, permissions, i18n, and tests. No behavioral changes.

---

## Rationale

"Volunteer" implies a specific role. "User" is the identity concept — anyone who authenticates and has roles within a hub. The word "Volunteer" remains as a default **role name**, not the identity concept. This aligns the app's internal terminology with the IdP facade (which already uses "user") and unblocks future role additions (Case Manager, Reporter) without awkward naming.

---

## 1. Database Migration

Single Drizzle migration. All operations are `ALTER TABLE ... RENAME` — no data transformation.

### Table rename

```sql
ALTER TABLE volunteers RENAME TO users;
```

### Column renames

| Table                           | Old Column                | New Column                  |
| ------------------------------- | ------------------------- | --------------------------- |
| `users` (formerly `volunteers`) | —                         | — (columns already generic) |
| `call_legs`                     | `volunteer_pubkey`        | `user_pubkey`               |
| `shift_schedules`               | `volunteer_pubkeys`       | `user_pubkeys`              |
| `shift_overrides`               | `volunteer_pubkeys`       | `user_pubkeys`              |
| `ring_groups`                   | `volunteer_pubkeys`       | `user_pubkeys`              |
| `fallback_group`                | `volunteer_pubkeys`       | `user_pubkeys`              |
| `webauthn_settings`             | `require_for_volunteers`  | `require_for_users`         |
| `custom_field_definitions`      | `show_in_volunteer_view`  | `show_in_user_view`         |
| `transcription_settings`        | `allow_volunteer_opt_out` | `allow_user_opt_out`        |

### Permission string migration

```sql
UPDATE roles SET permissions = replace(permissions::text, '"volunteers:', '"users:')::jsonb
  WHERE permissions::text LIKE '%"volunteers:%';
```

### Index renames

Rename any indexes that reference old table/column names to match. Drizzle may handle this automatically with the table rename; verify in the generated migration.

---

## 2. Drizzle Schema Changes

### `src/server/db/schema/identity.ts`

```typescript
// Before
export const volunteers = pgTable('volunteers', { ... })

// After
export const users = pgTable('users', { ... })
```

All column definitions stay identical (they're already generic — `pubkey`, `encryptedName`, `nameEnvelopes`, etc.).

### `src/server/db/schema/calls.ts`

```typescript
// Before
volunteerPubkey: text("volunteer_pubkey").notNull();

// After
userPubkey: text("user_pubkey").notNull();
```

### `src/server/db/schema/shifts.ts`

```typescript
// Before (on shiftSchedules, shiftOverrides, ringGroups)
volunteerPubkeys: jsonb<string[]>()("volunteer_pubkeys").notNull().default([]);

// After
userPubkeys: jsonb<string[]>()("user_pubkeys").notNull().default([]);
```

### `src/server/db/schema/settings.ts`

```typescript
// Before
showInVolunteerView: boolean("show_in_volunteer_view").notNull().default(false);
// After
showInUserView: boolean("show_in_user_view").notNull().default(false);

// Before (webauthnSettings)
requireForVolunteers: boolean("require_for_volunteers")
  .notNull()
  .default(false);
// After
requireForUsers: boolean("require_for_users").notNull().default(false);

// Before (transcriptionSettings)
allowVolunteerOptOut: boolean("allow_volunteer_opt_out")
  .notNull()
  .default(true);
// After
allowUserOptOut: boolean("allow_user_opt_out").notNull().default(true);
```

---

## 3. Shared Types & Permissions

### `src/shared/permissions.ts`

Permission domain rename:

```typescript
// Before
'volunteers:read': 'List/view volunteer profiles',
'volunteers:create': 'Create new volunteers',
'volunteers:update': 'Update volunteer profiles',
'volunteers:delete': 'Deactivate/delete volunteers',
'volunteers:manage-roles': 'Assign/change volunteer roles',

// After
'users:read': 'List/view user profiles',
'users:create': 'Create new users',
'users:update': 'Update user profiles',
'users:delete': 'Deactivate/delete users',
'users:manage-roles': 'Assign/change user roles',
```

Default role definitions: update any `volunteers:*` wildcard references to `users:*`.

The default role with `id: 'role-volunteer'`, `name: 'Volunteer'`, `slug: 'volunteer'` **keeps its id, name, and slug** — "Volunteer" is a valid role name.

### `src/shared/types.ts` / `src/server/types.ts`

```typescript
// Before
interface Volunteer { ... }
interface CreateVolunteerData { ... }
interface UpdateVolunteerData { ... }

// After
interface User { ... }
interface CreateUserData { ... }
interface UpdateUserData { ... }
```

Note: if `User` collides with any existing global type, use a namespace or rename to `AppUser`. Check at implementation time.

### `src/shared/crypto-labels.ts`

**`LABEL_VOLUNTEER_PII` must NOT change its string value.** The label `'llamenos:volunteer-pii:v1'` is a cryptographic domain separator baked into every encrypted volunteer/user name and phone field. Changing the string would break decryption of all existing ciphertext (even dev data).

The export name can optionally be aliased for clarity, but the value stays:

```typescript
// The string value is a cryptographic constant — never change it
export const LABEL_USER_PII = "llamenos:volunteer-pii:v1";
// Optionally keep the old name as a deprecated alias during transition
```

All 27 files importing `LABEL_VOLUNTEER_PII` update to import `LABEL_USER_PII`. Same string value, new export name.

---

## 4. Server Changes

### Route file rename

`src/server/routes/volunteers.ts` → `src/server/routes/users.ts`

All endpoints change path prefix:

```
/api/volunteers       → /api/users
/api/volunteers/:id   → /api/users/:id
```

### Service method renames (`src/server/services/identity.ts`)

| Before                          | After                      |
| ------------------------------- | -------------------------- |
| `getVolunteers()`               | `getUsers()`               |
| `getVolunteer(pubkey)`          | `getUser(pubkey)`          |
| `createVolunteer(data)`         | `createUser(data)`         |
| `updateVolunteer(pubkey, data)` | `updateUser(pubkey, data)` |
| `deleteVolunteer(pubkey)`       | `deleteUser(pubkey)`       |
| `VOLUNTEER_SAFE_FIELDS`         | `USER_SAFE_FIELDS`         |

### Other server files

All files importing from the volunteers route or referencing `volunteerPubkey` in queries update to the new names. This includes:

- `src/server/services/call-router.ts` (shift lookup by `userPubkeys`)
- `src/server/services/shift-manager.ts`
- `src/server/routes/shifts.ts`
- `src/server/app.ts` (route registration)
- Any test files referencing `/api/volunteers`

### `src/server/lib/volunteer-projector.ts`

If this file exists, rename to `user-projector.ts` and update all references.

---

## 5. Client Changes

### Route file renames

| Before                                      | After                                 |
| ------------------------------------------- | ------------------------------------- |
| `src/client/routes/volunteers.tsx`          | `src/client/routes/users.tsx`         |
| `src/client/routes/volunteers_.$pubkey.tsx` | `src/client/routes/users.$pubkey.tsx` |

TanStack Router file-based routing means the URL changes automatically with the filename.

### Component file renames

| Before                                                      | After                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `src/client/components/volunteer-multi-select.tsx`          | `src/client/components/user-multi-select.tsx`          |
| `src/client/components/dashboard/volunteer-stats-table.tsx` | `src/client/components/dashboard/user-stats-table.tsx` |

All internal component names, props, and exports rename accordingly.

### Query file rename

`src/client/lib/queries/volunteers.ts` → `src/client/lib/queries/users.ts`

```typescript
// Before
(queryKeys.volunteers.all,
  queryKeys.volunteers.list(),
  queryKeys.volunteers.detail(id));

// After
(queryKeys.users.all, queryKeys.users.list(), queryKeys.users.detail(id));
```

API calls update from `/api/volunteers` to `/api/users`.

### Navigation

Sidebar/nav links update from `/volunteers` to `/users`. Label stays localized via i18n keys.

### Other client files

All components that import from the renamed files or reference `volunteer` in variable names update. This is a mechanical find-and-replace verified by `tsc --noEmit`.

---

## 6. i18n — All 13 Locale Files

Every locale file (`src/client/locales/{en,es,zh,tl,vi,ar,fr,ht,ko,ru,hi,pt,de}.json`) updates:

### Key renames (structural)

| Old Key Pattern             | New Key Pattern   |
| --------------------------- | ----------------- |
| `volunteers` (section)      | `users`           |
| `volunteerStatus`           | `userStatus`      |
| `volunteerProfile` (object) | `userProfile`     |
| `searchVolunteers`          | `searchUsers`     |
| `noVolunteersFound`         | `noUsersFound`    |
| `noVolunteersOnline`        | `noUsersOnline`   |
| `volunteerAdded`            | `userAdded`       |
| `volunteerRemoved`          | `userRemoved`     |
| `volunteerOnBreak`          | `userOnBreak`     |
| `volunteerAvailable`        | `userAvailable`   |
| `requireForVolunteers`      | `requireForUsers` |
| `visibleToVolunteers`       | `visibleToUsers`  |
| `editableByVolunteers`      | `editableByUsers` |

### Value updates (display text)

English values change from "Volunteer(s)" to "User(s)" where referring to the identity concept. Values referring to the **role** (e.g., "Volunteer role") stay as-is.

For non-English locales, translate "User"/"Users" appropriately:

- es: "Usuario"/"Usuarios"
- fr: "Utilisateur"/"Utilisateurs"
- zh: "用户"
- ar: "مستخدم"/"مستخدمون"
- etc.

---

## 7. What Does NOT Change

| Item                               | Reason                                              |
| ---------------------------------- | --------------------------------------------------- |
| `role-volunteer` role ID           | "Volunteer" is a valid role name                    |
| `LABEL_VOLUNTEER_PII` string value | Cryptographic constant — changing breaks decryption |
| IdP facade / Authentik adapter     | Already uses "user" terminology                     |
| `assignedPubkey` on `active_calls` | Already generic                                     |
| Hub key infrastructure             | No volunteer references                             |
| Envelope encryption patterns       | No volunteer references                             |
| `LABEL_*` other crypto labels      | No volunteer references                             |

---

## 8. Verification

After all renames:

1. `bun run typecheck` — zero errors (TypeScript catches any missed references)
2. `bun run build` — clean build
3. `bun run test:unit` — all passing
4. `bun run test:api` — all passing (route paths updated)
5. `bun run test:e2e` — all passing (nav links, URLs updated)
6. `grep -r "volunteer" src/` — only hits should be: the role name string "Volunteer", `LABEL_USER_PII`'s value containing the historical string, and locale values for the Volunteer role name

---

## 9. Scope — What This Spec Does NOT Cover

- Permission model redesign (scope hierarchy, Case Manager role) — separate spec
- Behavioral changes to identity or auth
- New API endpoints or features
- Role editor UI redesign
