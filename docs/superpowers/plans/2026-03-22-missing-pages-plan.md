# Missing Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four missing pages identified by the UI audit: call detail view, volunteer profile edit page, and individual call note detail.

**Scope:** Three user-facing pages that complete common admin/volunteer workflows. Billing and system settings are deferred (future, out of scope for pre-production v1).

---

## Phase 1: Call Detail Page (`/calls/:callId`)

**Gap:** Call history list shows calls in a table. Clicking a call has no destination — no detail page exists.

### 1.1 API endpoint for call detail
- [ ] Add `GET /api/calls/:callId` to `src/worker/routes/calls.ts` (new endpoint — does not currently exist):
  - Returns: `{ call: CallRecord, notes: EncryptedNote[], recording?: RecordingMeta, auditEntries: AuditEntry[] }`
  - Permission: `calls:read-history` for admins (any call); volunteers see only calls where `answeredBy === viewer.pubkey` (returns 403 otherwise)
  - Decrypt logic happens client-side (notes are E2EE)

### 1.2 Create route file
- [ ] Create `src/client/routes/calls.$callId.tsx` (TanStack file-based routing):
  - Loader: `GET /api/calls/:callId` via TanStack `createFileRoute`
  - Two-column layout:
    - Left: Call metadata (date, duration, status, caller region/country, IVR language selected, volunteer who answered)
    - Right: Notes thread for this call (decrypted client-side)
  - Show recording player if recording exists
  - Show CAPTCHA result if CAPTCHA was used
  - Audit timeline at bottom (admin only): events related to this call

### 1.3 Link from call list
- [ ] Update `src/client/routes/calls.tsx` (call history list):
  - Make each row clickable → navigate to `/calls/:callId`
  - Add `<Link>` or `onClick` handler

### 1.4 Note creation from call detail
- [ ] Reuse existing `NewNoteForm` component, pre-filled with `callId`
- [ ] Notes created from call detail page are associated with this call

### 1.5 i18n keys
- [ ] Add to all 13 locale files: `calls.detail.title`, `calls.detail.metadata`, `calls.detail.notes`, `calls.detail.recording`, `calls.detail.audit`

### 1.6 Tests
- [ ] Add to `tests/call-flow.spec.ts` or new test:
  - Clicking a call in history navigates to `/calls/:callId`
  - Detail page shows call metadata (duration, status)
  - Notes for the call are visible

---

## Phase 2: Volunteer Profile Edit at `/settings`

**Gap:** The profile section lives at `/settings`. Verify it is complete and handles all required fields. Note: `/preferences` is a subscriber (caller) self-service page for messaging subscription management — do NOT add volunteer profile editing there.

**Note:** The admin can edit volunteer info via `/volunteers`. This is for volunteer self-service only.

### 2.1 Verify existing profile section in settings
- [ ] Check `src/client/routes/settings.tsx` — verify it already handles name, phone, and spoken languages
  - If all fields are present and correct: this task may be complete — add tests only
  - If fields are missing or broken: fix in the existing `settings.tsx` (do not create new routes)

### 2.2 Profile section requirements
- [ ] Ensure `src/client/routes/settings.tsx` includes:
  - Name field (text input, non-empty validation)
  - Phone field (E.164 format, masked display `+1 *** *** 1234`, with PIN re-authentication to view/change via `PinChallengeDialog`)
  - Spoken languages (multi-select with all 13 available languages)
  - Save button → `PATCH /auth/me/profile` with updated fields (existing endpoint in `src/worker/routes/auth.ts`)
  - Success toast on save

### 2.3 Use existing API endpoint
- [ ] Profile updates use `PATCH /auth/me/profile` in `src/worker/routes/auth.ts` — this endpoint already exists
  - Do NOT create `PATCH /api/volunteers/me` as a duplicate
  - Accepts `{ name?, phone?, spokenLanguages? }`, validates with Zod, returns updated profile

### 2.4 i18n keys
- [ ] Add to all 13 locales: `settings.profile.name`, `settings.profile.phone`, `settings.profile.spokenLanguages`, `settings.profile.save`

### 2.5 Tests
- [ ] Add to `tests/profile-settings.spec.ts`:
  - Volunteer can update name → persists after reload
  - Volunteer can update spoken languages → persists
  - Phone field requires PIN challenge to view
  - Save shows success toast

---

## Phase 3: Individual Note Detail / Permalink

**Gap:** Notes are displayed in groups by call ID in `/notes`. There is no permalink to a specific note (e.g., `/notes/:noteId`). This is needed for:
- Linking from audit log entries
- Sharing context within the team

### 3.1 Add note permalink route and API endpoint
- [ ] Add `GET /api/notes/:noteId` to `src/worker/routes/notes.ts` (new endpoint — does not currently exist):
  - Permission: volunteers only retrieve notes where `authorPubkey === viewer.pubkey`; admins with `calls:read-history` retrieve any note. Returns 403 otherwise.
- [ ] Create `src/client/routes/notes.$noteId.tsx`:
  - Loader: `GET /api/notes/:noteId`
  - Shows single note card (decrypted) with full content
  - Shows call context (link to call detail page)
  - Shows custom fields
  - Shows timestamp and author (own notes or admin)
  - Show edit button as DISABLED with tooltip: 'Edit from the call detail page (future feature)' — do NOT wire up an active edit flow. The edit button is a placeholder only.
- [ ] Handle unauthorized: volunteer sees 403 if trying to view another volunteer's note

### 3.2 Link from audit log
- [ ] Update audit log entries for `noteCreated` events to link to `/notes/:noteId`

### 3.3 Tests
- [ ] Add: navigate to `/notes/:noteId` → note renders correctly
- [ ] Unauthorized volunteer gets 403 on another volunteer's note

---

## Deferred (Future, Not In This Plan)

- **/admin/billing** — No billing system, not needed pre-production
- **/admin/system-settings** — Hub settings covers per-hub config; global system settings are future
- These are explicitly marked as out of scope

---

## Completion Checklist

- [ ] `/calls/:callId` route: renders metadata, notes, recording, audit trail
- [ ] Call history list: rows are clickable links
- [ ] `/settings`: profile section verified complete with name/phone/language editing
- [ ] Profile updates use existing `PATCH /auth/me/profile` endpoint (no duplicate endpoint created)
- [ ] Phone edit requires PIN challenge
- [ ] `/notes/:noteId` permalink route renders
- [ ] Audit log links to note detail where applicable
- [ ] All i18n keys added to 13 locales
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] E2E tests pass for each new page
