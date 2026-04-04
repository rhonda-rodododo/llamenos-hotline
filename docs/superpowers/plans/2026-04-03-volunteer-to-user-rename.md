# Volunteer → User Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename "volunteer" to "user" throughout the codebase — the identity concept, not the role name.

**Architecture:** Mechanical rename across DB schema, server, client, i18n. No behavioral changes. Pre-production: clean cut, no migration shims.

**Tech Stack:** Drizzle ORM (schema + migration), TypeScript, Bun

**CRITICAL:** `LABEL_VOLUNTEER_PII` in `src/shared/crypto-labels.ts` MUST NOT be renamed — it's a domain separation constant that would break decryption of existing data.

---

### Task 1: Database Schema Rename

**Files:**
- Modify: `src/server/db/schema/*.ts` — rename table and column references
- Create: migration via `bun run migrate:generate`

- [ ] Rename `volunteers` table → `users` in Drizzle schema
- [ ] Rename `volunteer_pubkey` columns → `user_pubkey` across all tables (call_legs, notes, audit_log, etc.)
- [ ] Rename `show_in_volunteer_view` → `show_in_user_view` (if exists)
- [ ] Run `bun run migrate:generate` to create SQL migration
- [ ] Verify migration SQL has correct ALTER TABLE RENAME statements
- [ ] `bun run typecheck`

### Task 2: Server Types & Services

**Files:**
- Modify: `src/server/types.ts` (and `types/users.ts`) — rename Volunteer types
- Modify: `src/server/services/identity.ts` — rename methods
- Modify: All services that reference "volunteer"

- [ ] Rename types: `Volunteer` → already `User`, `CreateVolunteerData` → `CreateUserData` (check if already done)
- [ ] Rename service methods: `listVolunteers` → `listUsers`, etc.
- [ ] Update all service consumers
- [ ] `bun run typecheck`

### Task 3: Server Routes

**Files:**
- Rename: `src/server/routes/volunteers.ts` → `src/server/routes/users.ts` (if not already done)
- Modify: `src/server/app.ts` — update route mounting

- [ ] Rename route file (if still named "volunteers")
- [ ] Update API paths: `/api/volunteers` → `/api/users` (if not already done)
- [ ] Update `app.ts` route mounting
- [ ] `bun run typecheck`

### Task 4: Client Routes & Components

**Files:**
- Rename client route files referencing "volunteers"
- Update component imports and text references

- [ ] Rename `src/client/routes/volunteers*.tsx` → `users*.tsx` (if not already done)
- [ ] Update TanStack Router file-based route paths
- [ ] Regenerate route tree: `bunx tsr generate`
- [ ] Update all component text that says "Volunteer" (where it means "User")
- [ ] `bun run typecheck && bun run build`

### Task 5: Permission Strings

**Files:**
- Modify: `src/shared/permissions.ts`
- Modify: All files referencing `volunteers:*` permissions

- [ ] Rename permission domain: `volunteers:*` → `users:*`
- [ ] Update default role definitions
- [ ] Update all permission check callsites
- [ ] Update DB migration to rename stored permission strings in roles table
- [ ] `bun run typecheck`

### Task 6: i18n Locale Files

**Files:**
- Modify: All 13 locale JSON files in `src/client/locales/`

- [ ] Rename translation keys from `volunteer.*` → `user.*`
- [ ] Update translation text that says "Volunteer" (where it means the identity concept, not the role)
- [ ] Keep "Volunteer" as a role name in translations
- [ ] `bun run typecheck && bun run build`

### Task 7: Tests & Verification

- [ ] Update test files that reference "volunteer" as identity concept
- [ ] Run full test suite: `bun run test:unit`
- [ ] Grep for remaining "volunteer" references: `grep -rn 'volunteer' src/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v 'role-volunteer' | grep -v LABEL_VOLUNTEER`
- [ ] Verify LABEL_VOLUNTEER_PII unchanged
- [ ] `bun run typecheck && bun run build && bun run test:unit`
- [ ] Commit
