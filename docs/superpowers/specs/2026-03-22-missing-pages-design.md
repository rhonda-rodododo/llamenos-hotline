# Missing Pages — Design Spec

**Date:** 2026-03-22
**Status:** Draft

## Problem

Three pages that complete standard admin/volunteer workflows are absent:

1. **Call detail** (`/calls/:callId`): The call history list shows calls in a table but clicking a row has no destination. There is no page to view a call's full metadata, notes, recording, or audit trail.
2. **Profile edit**: `/profile-setup` is a one-time wizard. After completing it, the volunteer profile section lives at `/settings` (name, phone, spoken languages). This section must be verified as complete and handling all required fields correctly. Note: `/preferences` is a separate subscriber (caller) self-service page and is unrelated to volunteer profile editing.
3. **Note permalink** (`/notes/:noteId`): Notes are displayed grouped by call in `/notes`. There is no URL that links to a specific note. This is needed for audit log entries that reference a note.

## Goals

1. `/calls/:callId` — renders call metadata, associated notes (decrypted), recording player if available, audit timeline (admin only).
2. Verify and complete the "Profile" section at `/settings` — name (non-empty), masked phone with PIN gate, spoken languages.
3. `/notes/:noteId` — renders a single note with full context; links back to the parent call.

## Non-Goals

- Inline note editing on the note detail page (notes are immutable once saved; edit is a future feature).
- Call recording playback (the player component itself may already exist; this spec is about wiring it in).
- Admin editing of another volunteer's profile from this page (that lives in `/volunteers`).

---

## 1. Call Detail Page (`/calls/:callId`)

### Route and Loader

TanStack file-based route: `src/client/routes/calls.$callId.tsx`

Loader: `GET /api/calls/:callId`

> **New endpoint required:** `GET /api/calls/:callId` does not currently exist and must be added to `src/worker/routes/calls.ts`. Returns a single call record with encrypted content. Permission: `calls:read-history` for admins; for volunteers, returns only calls they answered (filter by `answeredBy === viewer.pubkey`). Returns 403 if a volunteer requests a call they did not answer.

Response shape:
```typescript
{
  call: CallRecord,          // duration, status, startedAt, callerLast4, ivrLanguage, answeredBy
  notes: EncryptedNote[],    // decrypted client-side
  recording?: RecordingMeta, // exists if voicemail or recording was captured
  auditEntries: AuditEntry[] // admin-only; empty array for volunteers
}
```

Permission: volunteer sees only calls they answered. Admin sees all calls (`calls:read-history`).

### Layout

Two-column (desktop), single-column (mobile):
- **Left column:** Call metadata card
  - Date/time, duration, status badge (answered/voicemail/missed)
  - Caller: last 4 digits + region/country if geocoding is configured
  - IVR language selected by caller
  - Answered by: volunteer display name (linked to `/volunteers/:pubkey` for admin)
  - CAPTCHA result if CAPTCHA was used (passed/failed/skipped)
- **Right column:** Notes thread for this call
  - Decrypted client-side using the existing note decryption path
  - "Add note" form at bottom (pre-filled with callId, reuses `NewNoteForm`)
  - Recording player if `recording` exists

**Admin-only section** at bottom: Audit timeline for this call (events: call:answered, note:created, etc.)

### Link from Call List

`src/client/routes/calls.tsx`: each table row → `<Link to="/calls/$callId">`. Currently rows have no click handler; add it.

---

## 2. Profile Edit in Settings (`/settings`)

### Existing State

The profile section already exists at `/settings` (not `/preferences`). Note: `/preferences` is a subscriber (caller) self-service page for managing messaging subscriptions via token — it is NOT a volunteer profile page.

Verify that the existing `src/client/routes/settings.tsx` handles:
- **Display name**: non-empty validation, live save with toast
- **Phone number**: masked display (`+1 *** *** 1234`) with `PinChallengeDialog` for unmask/edit
- **Spoken languages**: multi-select (all 13 hub languages), save button

Any gaps found should be addressed in the existing `settings.tsx`, not a new route.

### Existing Endpoint: `PATCH /auth/me/profile`

The endpoint for profile updates already exists at `PATCH /auth/me/profile` in `src/worker/routes/auth.ts`. Do NOT create a duplicate `PATCH /api/volunteers/me`. All profile field updates (name, phone, spokenLanguages) must go through the existing endpoint. Accepts `{ name?, phone?, spokenLanguages? }`. Validates with Zod. PIN challenge is client-side (PIN re-verification before the PATCH is sent, not a separate server round-trip).

---

## 3. Note Permalink (`/notes/:noteId`)

### Route and Loader

TanStack file-based route: `src/client/routes/notes.$noteId.tsx`

Loader: `GET /api/notes/:noteId`

> **New endpoint required:** `GET /api/notes/:noteId` does not currently exist and must be added to `src/worker/routes/notes.ts`. Returns a single note with encrypted content. Permission: volunteers may only retrieve notes where `authorPubkey === viewer.pubkey`; admins with `calls:read-history` may retrieve any note. Returns 403 for unauthorized access.

Permission: volunteer sees only their own notes. Admin sees all notes.

Response: single encrypted note + call context (callId, callerLast4, date).

### Layout

Single note card:
- Decrypted content (full, not truncated)
- Custom field values (decrypted)
- Call context: "From call on [date] — [callerLast4]" → link to `/calls/:callId`
- Author and timestamp
- Edit button (if author or admin — future feature, can show disabled with tooltip for now)

**Unauthorized access**: Volunteer requesting another volunteer's note → 403 → rendered error page "You don't have permission to view this note."

### Link from Audit Log

Audit log entries for `noteCreated` events: hyperlink the note ID to `/notes/:noteId`.

---

## Testing

- Clicking a call row in history navigates to `/calls/:callId`
- Call detail shows duration, status, and caller info
- Notes for the call are visible and decrypted
- Admin sees audit timeline; volunteer does not
- Volunteer can update display name → persists after reload
- Phone field requires PIN challenge before showing full number
- Language multi-select saves correctly
- `/notes/:noteId` renders a note with call context link
- Unauthorized volunteer accessing another's note gets 403 page
