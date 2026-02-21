# Epic 57: Admin UX Improvements — Audit Filtering & Settings Status

## Overview

Two admin-facing pages need UX improvements that will matter significantly once real data flows through the system. The Audit Log currently has no filtering, which will be unusable at scale. The Admin Settings page shows collapsed sections with no indication of their current configuration state, forcing admins to expand every section to check status.

## Issue 1: Audit Log Filtering

### Problem

The Audit Log page renders a flat chronological list of events with only pagination. There is no way to filter by:
- Event type (e.g., "Volunteer Added", "Call Answered", "Settings Changed")
- Date range
- Actor (which admin/volunteer triggered the event)

With even modest hotline usage (10 calls/day, 5 volunteers), the audit log will quickly accumulate hundreds of entries. Admins need to answer questions like "what changed last night?" or "show me all login events" — impossible without filtering.

### Solution

Add a filter bar above the audit log entries, matching the visual pattern used by Call History (search + date range).

#### UI Design

```
┌─────────────────────────────────────────────────────────────────┐
│  🔍 Search actor name...    │ Event Type ▼ │ From 📅 │ To 📅 │ Q │
└─────────────────────────────────────────────────────────────────┘
```

**Filter controls:**
1. **Search** — text input, filters by actor name (fuzzy match)
2. **Event type** — dropdown/select with options derived from existing event types:
   - All Events (default)
   - Authentication (login, logout, session)
   - Volunteers (added, removed, role changed, activated, deactivated)
   - Calls (answered, missed, spam reported, transferred)
   - Settings (any admin settings change)
   - Shifts (created, updated, deleted)
   - Notes (created — metadata only, content is E2EE)
3. **Date range** — From/To date pickers (same as Call History)

**Backend changes:**
- `GET /api/audit` currently accepts `?page=N&limit=N`
- Add query params: `?type=authentication&actor=Admin&from=2026-02-01&to=2026-02-19`
- Filter logic in `RecordsDO` — audit entries are stored with `type`, `actor`, `timestamp` fields already, so filtering is just predicate matching on the existing data

#### Implementation

**Files to modify:**
- `src/client/routes/audit.tsx` — Add filter bar UI, wire query params to API call
- `src/worker/api/audit.ts` (or wherever the audit GET handler lives) — Add query param parsing and filtering
- `src/worker/durable-objects/records-do.ts` — Add filter predicates to audit entry retrieval

**Files to check:**
- `src/shared/types.ts` — Audit event type definitions (for dropdown options)

### 2. Event type badge colors

Currently audit entries show the event type as a plain teal badge. Different event categories should use distinct colors for scanability:
- Authentication events: blue
- Volunteer management: purple
- Call events: green
- Settings changes: amber
- Security events (failed login, rate limit): red

## Issue 2: Admin Settings Status Summaries

### Problem

The Admin Settings page shows 7+ collapsible sections. When all are collapsed, the admin sees:

```
▶ Passkey Policy
  Require passkeys for user groups...

▶ Telephony Provider
  Configure the telephony provider used for handling calls

▶ Transcription
  Uses AI to transcribe calls...
```

There's no indication of the current state. Is telephony configured? Which provider? Is transcription enabled? The admin must expand each section to find out.

### Solution

Add a small status chip/summary to each section header that shows the current configuration state at a glance.

#### UI Design

```
▶ Passkey Policy                                    Not required
▶ Telephony Provider                                Twilio ✓
▶ Transcription                                     Disabled
▶ IVR Language Menu                                 4 languages
▶ Call Settings                                     Queue: 3min, VM: on
▶ Voice Prompts                                     Default
▶ Custom Fields                                     3 fields
▶ Spam Settings                                     CAPTCHA: off, Rate limit: on
▶ Messaging Channels                                SMS ✓  WhatsApp ✗  Signal ✗
▶ Reports                                           Enabled (3 categories)
```

Each status summary is:
- Positioned at the right side of the section header row
- Styled as `text-xs text-muted-foreground` (subtle, not competing with the title)
- Shows "Not configured" or "Disabled" in a muted style when unconfigured
- Shows the configured value with a subtle check when configured

#### Implementation

**Approach:** Each settings section component already receives the current settings data as props. Add a `statusSummary` computed value that derives a short string from the current config, and render it in the section header.

**Files to modify:**
- `src/client/routes/admin/settings.tsx` — Add status text to each `SettingsSection` header

The section header component likely has a pattern like:
```tsx
<Collapsible open={expanded} onOpenChange={onToggle}>
  <CollapsibleTrigger className="flex w-full items-center justify-between ...">
    <div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
    <ChevronDown />
  </CollapsibleTrigger>
  ...
</Collapsible>
```

Add between the title/description and the chevron:
```tsx
{!expanded && statusSummary && (
  <span className="hidden sm:block text-xs text-muted-foreground whitespace-nowrap">
    {statusSummary}
  </span>
)}
```

Only shown when collapsed (`!expanded`) and on `sm:` screens and up (avoids clutter on mobile).

**Status derivation per section:**

| Section | Status Logic |
|---------|-------------|
| Passkey Policy | "Required for admins" / "Required for all" / "Not required" |
| Telephony | Provider name if configured, "Not configured" otherwise |
| Transcription | "Enabled" / "Disabled" |
| IVR Languages | Count of enabled languages (e.g., "4 languages") |
| Call Settings | Queue timeout + voicemail status |
| Voice Prompts | "Customized" if any changed, "Default" otherwise |
| Custom Fields | Count of fields (e.g., "3 fields") or "None" |
| Spam Settings | CAPTCHA + rate limit status |
| Messaging | Per-channel enabled/disabled |
| Reports | "Enabled (N categories)" / "Disabled" |

## Testing

### Audit Log Filtering
- E2E test: login as admin, generate a few audit events (add volunteer, change settings), verify filters narrow the list correctly
- Test date range filtering
- Test event type dropdown filters
- Test search by actor name
- Test that clearing filters restores the full list

### Admin Settings Status
- E2E test: verify status summaries appear when sections are collapsed
- Configure telephony, verify status updates to show provider name
- Enable transcription, verify status changes from "Disabled" to "Enabled"

## Acceptance Criteria

- [ ] Audit log has search, event type dropdown, and date range filters
- [ ] Filters are applied server-side (not just client-side) so pagination still works
- [ ] Audit event type badges use category-specific colors
- [ ] Each admin settings section shows a status summary when collapsed
- [ ] Status summaries update reactively when settings change
- [ ] All existing E2E tests pass
- [ ] New E2E tests cover filtering and status display
