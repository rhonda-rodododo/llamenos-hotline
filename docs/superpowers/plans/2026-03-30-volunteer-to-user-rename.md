# Volunteer → User Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the identity concept from "volunteer" to "user" across the entire stack — DB schema, server, client, permissions, i18n, and tests.

**Architecture:** Mechanical find-and-replace in dependency order: schema first, then shared types/permissions, then server services/routes, then client, then tests. Each phase verified by typecheck before moving to the next. The word "Volunteer" remains as a role name only.

**Tech Stack:** Drizzle ORM (migrations), TypeScript, Bun, Hono, TanStack Router, React Query, i18next, Playwright

---

### Task 1: Database Migration

**Files:**
- Create: `drizzle/migrations/XXXX_volunteer_to_user_rename.sql` (Drizzle will generate)
- Modify: `src/server/db/schema/identity.ts:6,88`
- Modify: `src/server/db/schema/calls.ts:21`
- Modify: `src/server/db/schema/shifts.ts:12,23,31`
- Modify: `src/server/db/schema/settings.ts:48,94,104`

- [ ] **Step 1: Update Drizzle schema — identity.ts**

In `src/server/db/schema/identity.ts`, change:
```typescript
// Line 6: table name
export const volunteers = pgTable('volunteers', {
// →
export const users = pgTable('users', {

// Line 88: webauthn settings column
requireForVolunteers: boolean('require_for_volunteers').notNull().default(false),
// →
requireForUsers: boolean('require_for_users').notNull().default(false),
```

Also rename the export everywhere it's imported: `import { volunteers } from '../db/schema'` → `import { users } from '../db/schema'`.

- [ ] **Step 2: Update Drizzle schema — calls.ts**

In `src/server/db/schema/calls.ts`, line 21:
```typescript
volunteerPubkey: text('volunteer_pubkey').notNull(),
// →
userPubkey: text('user_pubkey').notNull(),
```

- [ ] **Step 3: Update Drizzle schema — shifts.ts**

In `src/server/db/schema/shifts.ts`, lines 12, 23, 31:
```typescript
// shiftSchedules (line 12)
volunteerPubkeys: jsonb<string[]>()('volunteer_pubkeys').notNull().default([]),
// →
userPubkeys: jsonb<string[]>()('user_pubkeys').notNull().default([]),

// shiftOverrides (line 23) — same change
// ringGroups (line 31) — same change
```

- [ ] **Step 4: Update Drizzle schema — settings.ts**

In `src/server/db/schema/settings.ts`:
```typescript
// Line 48: custom field definitions
showInVolunteerView: boolean('show_in_volunteer_view').notNull().default(false),
// →
showInUserView: boolean('show_in_user_view').notNull().default(false),

// Line 94: transcription settings
allowVolunteerOptOut: boolean('allow_volunteer_opt_out').notNull().default(true),
// →
allowUserOptOut: boolean('allow_user_opt_out').notNull().default(true),

// Line 104: fallback group
volunteerPubkeys: jsonb<string[]>()('volunteer_pubkeys').notNull().default([]),
// →
userPubkeys: jsonb<string[]>()('user_pubkeys').notNull().default([]),
```

- [ ] **Step 5: Generate Drizzle migration**

Run: `bun run migrate:generate`

This will generate a SQL migration file. Verify it contains:
- `ALTER TABLE volunteers RENAME TO users`
- Column renames for all changed columns
- Permission string replacement

If Drizzle doesn't generate column renames automatically (it may not for renames vs drop+add), manually write the migration:

```sql
ALTER TABLE volunteers RENAME TO users;
ALTER TABLE call_legs RENAME COLUMN volunteer_pubkey TO user_pubkey;
ALTER TABLE shift_schedules RENAME COLUMN volunteer_pubkeys TO user_pubkeys;
ALTER TABLE shift_overrides RENAME COLUMN volunteer_pubkeys TO user_pubkeys;
ALTER TABLE ring_groups RENAME COLUMN volunteer_pubkeys TO user_pubkeys;
ALTER TABLE fallback_group RENAME COLUMN volunteer_pubkeys TO user_pubkeys;
ALTER TABLE webauthn_settings RENAME COLUMN require_for_volunteers TO require_for_users;
ALTER TABLE custom_field_definitions RENAME COLUMN show_in_volunteer_view TO show_in_user_view;
ALTER TABLE transcription_settings RENAME COLUMN allow_volunteer_opt_out TO allow_user_opt_out;
UPDATE roles SET permissions = replace(permissions::text, '"volunteers:', '"users:')::jsonb
  WHERE permissions::text LIKE '%"volunteers:%';
```

- [ ] **Step 6: Update schema barrel export**

In `src/server/db/schema/index.ts` (or wherever schema is re-exported), update `volunteers` → `users` in all exports.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/schema/ drizzle/
git commit -m "feat: rename volunteers table to users in Drizzle schema and migration"
```

---

### Task 2: Shared Types, Permissions & Crypto Labels

**Files:**
- Modify: `src/server/types.ts:134-157`
- Modify: `src/shared/types.ts:211-212`
- Modify: `src/shared/permissions.ts:65-70,172-267,307-316,345-349`
- Modify: `src/shared/crypto-labels.ts:185`
- Modify: `src/shared/demo-accounts.ts`
- Modify: `src/shared/nostr-events.ts`
- Modify: `src/shared/voice-prompts.ts`

- [ ] **Step 1: Rename types in src/server/types.ts**

Replace throughout the file:
- `Volunteer` interface → `User`
- `CreateVolunteerData` → `CreateUserData`
- `UpdateVolunteerData` → `UpdateUserData`
- `UserRole = 'volunteer' | 'admin' | 'reporter'` — keep `'volunteer'` as a role value, this is correct
- `volunteerPubkeys: string[]` → `userPubkeys: string[]` in Shift type
- `AppEnv.Variables.volunteer: Volunteer` → `AppEnv.Variables.user: User` (line 444)
- Any comment referencing "volunteer" as the identity concept → "user"

- [ ] **Step 2: Rename types in src/shared/types.ts**

```typescript
// Line 211-212
visibleToVolunteers: boolean
editableByVolunteers: boolean
// →
visibleToUsers: boolean
editableByUsers: boolean
```

Also update `maxConcurrentPerVolunteer` → `maxConcurrentPerUser` and `autoAssign` comment.

- [ ] **Step 3: Rename permissions in src/shared/permissions.ts**

Replace the volunteers domain:
```typescript
// Lines 65-70
'volunteers:read': 'List/view volunteer profiles',
'volunteers:create': 'Create new volunteers',
'volunteers:update': 'Update volunteer profiles',
'volunteers:delete': 'Deactivate/delete volunteers',
'volunteers:manage-roles': 'Assign/change volunteer roles',
// →
'users:read': 'List/view user profiles',
'users:create': 'Create new users',
'users:update': 'Update user profiles',
'users:delete': 'Deactivate/delete users',
'users:manage-roles': 'Assign/change user roles',
```

Update default roles:
- Hub Admin: `'volunteers:*'` → `'users:*'`
- Hub Admin description: "manages volunteers" → "manages users"
- Volunteer role: `'volunteers:read'` → `'users:read'` (keeps role id `role-volunteer`)
- Reviewer description: "assigned volunteers" → "assigned users"
- `ROLE_PRIORITY`: keep `'role-volunteer': 3` (role name unchanged)
- Presence permission label: "View volunteer presence" → "View user presence"
- Notes assigned label: "from assigned volunteers" → "from assigned users"

- [ ] **Step 4: Rename crypto label export**

In `src/shared/crypto-labels.ts`:
```typescript
// Line 185 — rename export only, keep string value!
export const LABEL_VOLUNTEER_PII = 'llamenos:volunteer-pii:v1'
// →
export const LABEL_USER_PII = 'llamenos:volunteer-pii:v1'
```

- [ ] **Step 5: Update demo accounts and other shared files**

Update `src/shared/demo-accounts.ts`, `src/shared/nostr-events.ts`, `src/shared/voice-prompts.ts` — rename volunteer identity references, keep volunteer role name references.

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`

Expected: Many errors in server/client code still referencing old names. That's correct — we fix those in the next tasks.

- [ ] **Step 7: Commit**

```bash
git add src/server/types.ts src/shared/
git commit -m "feat: rename Volunteer types, permissions, and crypto label to User"
```

---

### Task 3: Server Services & Lib

**Files:**
- Rename: `src/server/lib/volunteer-projector.ts` → `src/server/lib/user-projector.ts`
- Modify: `src/server/services/identity.ts` (massive — all method names)
- Modify: `src/server/services/conversations.ts`
- Modify: `src/server/services/gdpr.ts`
- Modify: `src/server/services/push.ts`
- Modify: `src/server/services/records.ts`
- Modify: `src/server/services/settings.ts`
- Modify: `src/server/services/shifts.ts`
- Modify: `src/server/lib/auth.ts`
- Modify: `src/server/lib/ringing.ts`
- Modify: `src/server/lib/transcription-manager.ts`
- Modify: `src/server/lib/test-payload-factory.ts`
- Modify: `src/server/middleware/auth.ts`
- Modify: `src/server/middleware/hub.ts`

- [ ] **Step 1: Rename volunteer-projector file**

```bash
cd /home/rikki/projects/llamenos-hotline-cms
git mv src/server/lib/volunteer-projector.ts src/server/lib/user-projector.ts
```

Inside the file, rename:
- `projectVolunteer()` → `projectUser()`
- All internal references

- [ ] **Step 2: Rename identity service methods**

In `src/server/services/identity.ts`, apply these renames throughout:
- `getVolunteers()` → `getUsers()`
- `getVolunteer()` → `getUser()`
- `createVolunteer()` → `createUser()`
- `updateVolunteer()` → `updateUser()`
- `deleteVolunteer()` → `deleteUser()`
- `bootstrapAdmin` internal references
- `redeemInvite` internal references
- `setHubRole` / `removeHubRole` internal references
- `VOLUNTEER_SAFE_FIELDS` → `USER_SAFE_FIELDS`
- `#rowToVolunteer()` → `#rowToUser()`
- `getEffectiveVolunteers()` → `getEffectiveUsers()`
- `getVolunteerStatus()` → `getUserStatus()`
- Import: `volunteers` schema → `users`
- Import: `LABEL_VOLUNTEER_PII` → `LABEL_USER_PII`
- Import: `Volunteer` → `User`, `CreateVolunteerData` → `CreateUserData`, etc.
- Comments: "volunteer" identity concept → "user"

- [ ] **Step 3: Update remaining server services**

For each of these files, replace volunteer references:
- `src/server/services/conversations.ts`: import and E2EE references
- `src/server/services/gdpr.ts`: `exportForVolunteer()` → `exportForUser()`, `eraseVolunteer()` → `eraseUser()`
- `src/server/services/push.ts`: `sendPushToVolunteers()` → `sendPushToUsers()`
- `src/server/services/records.ts`: `getVolunteerCallStats()` → `getUserCallStats()`, import renames
- `src/server/services/settings.ts`: `visibleToVolunteers` → `visibleToUsers`, `allowVolunteerOptOut` → `allowUserOptOut`, schema import
- `src/server/services/shifts.ts`: `volunteerPubkeys` → `userPubkeys`, method renames

- [ ] **Step 4: Update server lib files**

- `src/server/lib/auth.ts`: `Volunteer` type → `User`, `getVolunteer()` → `getUser()`
- `src/server/lib/ringing.ts`: all volunteer variable/comment references
- `src/server/lib/transcription-manager.ts`: `volunteerPubkey` param → `userPubkey`
- `src/server/lib/test-payload-factory.ts`: `volunteerPubkey` field, `volunteer-answer` endpoint → `user-answer`

- [ ] **Step 5: Update middleware**

- `src/server/middleware/auth.ts`: `c.set('volunteer', ...)` → `c.set('user', ...)`, `authResult.volunteer` → `authResult.user`
- `src/server/middleware/hub.ts`: `c.get('volunteer')` → `c.get('user')`

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`

Expected: Errors in routes and client code only. Services/lib should be clean.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/ src/server/lib/ src/server/middleware/
git commit -m "feat: rename volunteer to user in server services, lib, and middleware"
```

---

### Task 4: Server Routes & App Wiring

**Files:**
- Rename: `src/server/routes/volunteers.ts` → `src/server/routes/users.ts`
- Modify: `src/server/app.ts:41,191`
- Modify: `src/server/routes/analytics.ts`
- Modify: `src/server/routes/auth.ts`
- Modify: `src/server/routes/auth-facade.ts`
- Modify: `src/server/routes/calls.ts`
- Modify: `src/server/routes/conversations.ts`
- Modify: `src/server/routes/dev.ts`
- Modify: `src/server/routes/gdpr.ts`
- Modify: `src/server/routes/hubs.ts`
- Modify: `src/server/routes/invites.ts`
- Modify: `src/server/routes/notes.ts`
- Modify: `src/server/routes/reports.ts`
- Modify: `src/server/routes/settings.ts`
- Modify: `src/server/routes/shifts.ts`
- Modify: `src/server/routes/telephony.ts`
- Modify: `src/server/routes/webrtc.ts`

- [ ] **Step 1: Rename volunteers route file**

```bash
cd /home/rikki/projects/llamenos-hotline-cms
git mv src/server/routes/volunteers.ts src/server/routes/users.ts
```

Inside `users.ts`:
- `const volunteers = new Hono` → `const users = new Hono`
- Permission guards: `'volunteers:read'` → `'users:read'`, etc.
- Method calls: `getVolunteers()` → `getUsers()`, etc.
- Projector: `projectVolunteer()` → `projectUser()`
- `c.get('volunteer')` → `c.get('user')`
- Audit events: `'volunteerAdded'` → `'userAdded'`, `'volunteerRemoved'` → `'userRemoved'`
- `export default volunteers` → `export default users`

- [ ] **Step 2: Update app.ts wiring**

```typescript
// Line 41
import volunteersRoutes from './routes/volunteers'
// →
import usersRoutes from './routes/users'

// Line 191
authenticated.route('/volunteers', volunteersRoutes)
// →
authenticated.route('/users', usersRoutes)
```

- [ ] **Step 3: Update all other route files**

For each route file, replace:
- `c.get('volunteer')` → `c.get('user')`
- `import { projectVolunteer }` → `import { projectUser }`
- `import { maskPhone } from '../lib/volunteer-projector'` → `from '../lib/user-projector'`
- `resolveVolunteerPermissions()` → `resolveUserPermissions()`
- `services.identity.getVolunteer()` → `services.identity.getUser()`
- `services.identity.createVolunteer()` → `services.identity.createUser()`
- `services.identity.updateVolunteer()` → `services.identity.updateUser()`
- `services.identity.deleteVolunteer()` → `services.identity.deleteUser()`
- `'volunteers:*'` permission strings → `'users:*'`
- `requireForVolunteers` → `requireForUsers`
- `hasAvailableVolunteers` → `hasAvailableUsers` (in telephony.ts)
- `/volunteer-answer` endpoint → `/user-answer` (in telephony.ts)
- Comments: identity concept only, not role name

- [ ] **Step 4: Run typecheck and build**

Run: `bun run typecheck && bun run build`

Expected: Server should be clean. Client will have errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/ src/server/app.ts
git commit -m "feat: rename volunteer to user in server routes and app wiring"
```

---

### Task 5: Client — API, Queries, Types

**Files:**
- Rename: `src/client/lib/queries/volunteers.ts` → `src/client/lib/queries/users.ts`
- Modify: `src/client/lib/queries/keys.ts`
- Modify: `src/client/lib/api.ts`
- Modify: `src/client/lib/demo-accounts.ts`
- Modify: Any files importing from queries/volunteers

- [ ] **Step 1: Rename queries file**

```bash
cd /home/rikki/projects/llamenos-hotline-cms
git mv src/client/lib/queries/volunteers.ts src/client/lib/queries/users.ts
```

Inside `users.ts`:
- All hook names: `useVolunteers` → `useUsers`, `useVolunteer` → `useUser`, etc.
- Options: `volunteersListOptions` → `usersListOptions`, etc.
- API calls: `listVolunteers()` → `listUsers()`, etc.
- Query keys: reference `queryKeys.users` instead of `queryKeys.volunteers`
- Import: `LABEL_VOLUNTEER_PII` → `LABEL_USER_PII`

- [ ] **Step 2: Update query keys**

In `src/client/lib/queries/keys.ts`:
```typescript
// Lines 12-15
volunteers: {
  all: ['volunteers'] as const,
  list: () => [..., 'volunteers', 'list'] as const,
  detail: (pubkey: string) => [..., 'volunteers', 'detail', pubkey] as const,
},
// →
users: {
  all: ['users'] as const,
  list: () => [..., 'users', 'list'] as const,
  detail: (pubkey: string) => [..., 'users', 'detail', pubkey] as const,
},
```

Also update `volunteerStats` → `userStats` in analytics keys.

- [ ] **Step 3: Update api.ts**

In `src/client/lib/api.ts`, rename:
- `listVolunteers()` → `listUsers()`, endpoint `/api/volunteers` → `/api/users`
- `createVolunteer()` → `createUser()`
- `updateVolunteer()` → `updateUser()`
- `deleteVolunteer()` → `deleteUser()`
- `getVolunteerUnmasked()` → `getUserUnmasked()`
- `getVolunteerStats()` → `getUserStats()`, endpoint `/api/analytics/volunteers` → `/api/analytics/users`
- `getVolunteerLoads()` → `getUserLoads()`
- `Volunteer` interface → `User`
- `VolunteerPresence` → `UserPresence`
- `VolunteerStatEntry` → `UserStatEntry`
- `volunteerPubkeys` → `userPubkeys`
- `requireForVolunteers` → `requireForUsers`
- `allowVolunteerOptOut` → `allowUserOptOut`
- `UserRole` — keep `'volunteer'` as a valid role value
- Fallback group: `volunteers` field → `users`
- Demo account creation: update variable names

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/
git commit -m "feat: rename volunteer to user in client API, queries, and types"
```

---

### Task 6: Client — Routes & Components

**Files:**
- Rename: `src/client/routes/volunteers.tsx` → `src/client/routes/users.tsx`
- Rename: `src/client/routes/volunteers_.$pubkey.tsx` → `src/client/routes/users_.$pubkey.tsx`
- Rename: `src/client/components/volunteer-multi-select.tsx` → `src/client/components/user-multi-select.tsx`
- Rename: `src/client/components/dashboard/volunteer-stats-table.tsx` → `src/client/components/dashboard/user-stats-table.tsx`
- Modify: `src/client/routes/__root.tsx` (nav link)
- Modify: `src/client/routes/index.tsx` (dashboard)
- Modify: `src/client/routes/audit.tsx`
- Modify: `src/client/routes/calls.tsx`, `src/client/routes/calls.$callId.tsx`
- Modify: `src/client/routes/notes.tsx`, `src/client/routes/notes.$noteId.tsx`
- Modify: `src/client/routes/shifts.tsx`
- Modify: `src/client/routes/settings.tsx`
- Modify: `src/client/routes/onboarding.tsx`
- Modify: `src/client/routes/help.tsx`
- Modify: All other route/component files with volunteer references

- [ ] **Step 1: Rename route and component files**

```bash
cd /home/rikki/projects/llamenos-hotline-cms
git mv src/client/routes/volunteers.tsx src/client/routes/users.tsx
git mv src/client/routes/volunteers_.\$pubkey.tsx src/client/routes/users_.\$pubkey.tsx
git mv src/client/components/volunteer-multi-select.tsx src/client/components/user-multi-select.tsx
git mv src/client/components/dashboard/volunteer-stats-table.tsx src/client/components/dashboard/user-stats-table.tsx
```

- [ ] **Step 2: Update renamed files internally**

Inside each renamed file:
- Component names: `VolunteerMultiSelect` → `UserMultiSelect`, etc.
- TanStack Router route paths: `createFileRoute('/volunteers')` → `createFileRoute('/users')`
- Import paths for queries: `from '@/lib/queries/volunteers'` → `from '@/lib/queries/users'`
- Hook names: `useVolunteers()` → `useUsers()`
- Variable names: `volunteer` → `user` (identity concept only)
- i18n keys: `t('volunteers.*')` → `t('users.*')`

- [ ] **Step 3: Update all other route files**

For every route file with volunteer references, replace:
- Import paths: `queries/volunteers` → `queries/users`
- Hook names: `useVolunteers` → `useUsers`
- Component names: `VolunteerMultiSelect` → `UserMultiSelect`, `VolunteerStatsTable` → `UserStatsTable`
- Nav links: `/volunteers` → `/users`
- i18n keys: `volunteers.*` → `users.*`
- Variable names: `volunteer` (identity) → `user`
- `visibleToVolunteers` → `visibleToUsers`
- `allowVolunteerOptOut` → `allowUserOptOut`

- [ ] **Step 4: Update root route nav**

In `src/client/routes/__root.tsx`:
```typescript
// Navigation link
{ to: '/volunteers', ... }
// →
{ to: '/users', ... }
```

- [ ] **Step 5: Run typecheck and build**

Run: `bun run typecheck && bun run build`

Expected: Should pass — all server and client code now uses "user" terminology.

- [ ] **Step 6: Commit**

```bash
git add src/client/
git commit -m "feat: rename volunteer to user in client routes and components"
```

---

### Task 7: i18n Locale Files

**Files:**
- Modify: All 13 files in `src/client/locales/`

- [ ] **Step 1: Update English locale**

In `src/client/locales/en.json`, rename all keys and values:

Key renames (structural):
- `"volunteers"` section → `"users"`
- `"volunteerStatus"` → `"userStatus"`
- `"volunteerProfile"` → `"userProfile"`
- `"searchVolunteers"` → `"searchUsers"`
- `"noVolunteersFound"` → `"noUsersFound"`
- `"noVolunteersOnline"` → `"noUsersOnline"`
- `"volunteerAdded"` → `"userAdded"`
- `"volunteerRemoved"` → `"userRemoved"`
- `"volunteerOnBreak"` → `"userOnBreak"`
- `"volunteerAvailable"` → `"userAvailable"`
- `"requireForVolunteers"` → `"requireForUsers"`
- `"visibleToVolunteers"` → `"visibleToUsers"`
- `"editableByVolunteers"` → `"editableByUsers"`

Value updates: "Volunteer(s)" → "User(s)" where referring to identity concept. Keep "Volunteer" where it refers to the role name.

- [ ] **Step 2: Update remaining 12 locale files**

For each non-English locale (`ar, de, es, fr, hi, ht, ko, pt, ru, tl, vi, zh`):
- Same key renames as English
- Translate "User"/"Users" appropriately:
  - es: "Usuario"/"Usuarios"
  - fr: "Utilisateur"/"Utilisateurs"
  - zh: "用户"
  - ar: "مستخدم"/"مستخدمون"
  - de: "Benutzer"
  - hi: "उपयोगकर्ता"
  - ht: "Itilizatè"
  - ko: "사용자"
  - pt: "Usuário"/"Usuários"
  - ru: "Пользователь"/"Пользователи"
  - tl: "User" (Filipino commonly uses English)
  - vi: "Người dùng"

- [ ] **Step 3: Commit**

```bash
git add src/client/locales/
git commit -m "feat: rename volunteer to user in all 13 locale files"
```

---

### Task 8: Test Files

**Files:**
- Rename: `tests/ui/volunteer-flow.spec.ts` → `tests/ui/user-flow.spec.ts`
- Rename: `tests/api/volunteer-lifecycle.spec.ts` → `tests/api/user-lifecycle.spec.ts`
- Rename: `tests/api/volunteer-pii.spec.ts` → `tests/api/user-pii.spec.ts`
- Modify: ~50 test files with volunteer references

- [ ] **Step 1: Rename test files**

```bash
cd /home/rikki/projects/llamenos-hotline-cms
git mv tests/ui/volunteer-flow.spec.ts tests/ui/user-flow.spec.ts
git mv tests/api/volunteer-lifecycle.spec.ts tests/api/user-lifecycle.spec.ts
git mv tests/api/volunteer-pii.spec.ts tests/api/user-pii.spec.ts
```

- [ ] **Step 2: Update all test file contents**

For ALL test files (unit, API, UI, integration), replace:
- `/api/volunteers` → `/api/users`
- `/api/analytics/volunteers` → `/api/analytics/users`
- `/volunteer-answer` → `/user-answer`
- `volunteers:read` → `users:read` (and other permission strings)
- `LABEL_VOLUNTEER_PII` → `LABEL_USER_PII`
- `Volunteer` type → `User`
- `getVolunteer` → `getUser` (and other method names)
- `createVolunteer` → `createUser`
- Variable names: `volunteer` (identity) → `user`
- Test descriptions: "volunteer" (identity) → "user"
- Demo data: update pubkey variable names
- Keep "Volunteer" where it refers to the role name (e.g., `'role-volunteer'`)

- [ ] **Step 3: Run all tests**

```bash
bun run test:unit
bun run test:api    # requires dev:docker running
bun run test:e2e    # requires dev:docker + dev:server running
```

Expected: All tests pass with renamed paths and identifiers.

- [ ] **Step 4: Commit**

```bash
git add tests/ src/server/services/*.test.ts src/server/lib/*.test.ts src/shared/*.test.ts src/client/lib/*.test.ts
git commit -m "feat: rename volunteer to user in all test files"
```

---

### Task 9: Final Verification & Cleanup

**Files:**
- Modify: Any remaining files found by grep

- [ ] **Step 1: Grep for remaining volunteer references**

```bash
grep -rn "volunteer\|Volunteer\|VOLUNTEER" src/ tests/ --include="*.ts" --include="*.tsx" --include="*.json" | grep -v node_modules | grep -v "role-volunteer\|role_volunteer\|'Volunteer'\|\"Volunteer\"\|volunteer-pii:v1"
```

This filters out:
- `role-volunteer` / `role_volunteer` (role ID — stays)
- `'Volunteer'` / `"Volunteer"` (role display name — stays)
- `volunteer-pii:v1` (crypto label string value — stays)

Any remaining hits are missed renames. Fix them.

- [ ] **Step 2: Full verification**

Run in sequence:
```bash
bun run typecheck
bun run build
bun run lint
bun run test:unit
```

All must pass.

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address remaining volunteer references found by grep"
```

- [ ] **Step 4: Update CLAUDE.md architecture table**

In the root `CLAUDE.md`, update the Architecture Roles table:
```
| **Volunteer** | Own notes only | Answer calls, write notes during shift |
```
This stays — "Volunteer" is a role name. But update any text that says "volunteers table" to "users table".

Also update the Directory Structure section if it references volunteer-specific files.

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for volunteer to user rename"
```
