# Epic 56: UI Polish — Page Consistency & Visual Refinement

## Overview

Design review revealed several visual inconsistencies, suboptimal empty states, and unpolished interaction patterns across the frontend. These are all cosmetic/UX issues — no backend changes required. Each fix is small in scope but collectively they bring the app to production-grade polish.

## Issues & Fixes

### 1. Conversations page missing heading

**Problem**: Every other page follows the pattern `Icon + <h1>Title</h1>` at the top of the content area. The Conversations page has no top-level heading — the title only appears as an `<h2>` inside the conversation sidebar panel. When no messaging channels are enabled, the empty state floats in a headingless void.

**Fix**: Add a consistent page heading above the conversation layout:
```tsx
<div className="space-y-4">
  <h1 className="flex items-center gap-3 text-2xl font-bold">
    <MessageSquare className="h-6 w-6" />
    {t('conversations.title')}
  </h1>
  {/* existing conversation layout */}
</div>
```

**File**: `src/client/routes/conversations.tsx`

### 2. Reports empty state wastes space with split panel

**Problem**: The Reports page uses a master/detail split-panel layout (`w-80` sidebar + flex-1 detail). When there are zero reports, both panels show separate empty states ("No reports" on left, "Select a report to view details" on right), wasting screen real estate and looking broken.

**Fix**: When `reports.length === 0`, render a single full-width centered empty state (matching the pattern used by Notes, Calls, and Bans pages). Only show the split panel when at least one report exists.

```tsx
{reports.length === 0 ? (
  <Card>
    <CardContent className="flex flex-col items-center justify-center py-16 text-center">
      <FileText className="mb-3 h-10 w-10 text-muted-foreground/40" />
      <p className="text-muted-foreground">{t('reports.noReports')}</p>
      {isAdmin && (
        <p className="mt-1 text-sm text-muted-foreground">
          {t('reports.noReportsHint', { defaultValue: 'Reports submitted by volunteers and reporters will appear here.' })}
        </p>
      )}
    </CardContent>
  </Card>
) : (
  <div className="flex h-[calc(100vh-8rem)] gap-4">
    {/* existing split panel */}
  </div>
)}
```

**File**: `src/client/routes/reports.tsx`

### 3. Volunteer phone display inconsistency

**Problem**: On the Volunteers page, the admin user shows just the eye icon with no phone text, while other volunteers show a masked phone number (`+15•••••••50`) with a toggle. This inconsistency happens because the admin may not have a phone number set, but the eye icon still renders.

**Fix**: Only render the phone row (masked number + eye toggle) when `volunteer.phone` is truthy. When phone is empty/undefined, don't render the eye icon at all.

```tsx
{volunteer.phone && (
  <p className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
    {showPhone[volunteer.pubkey] ? volunteer.phone : maskedPhone(volunteer.phone)}
    <button ...>
      {showPhone[volunteer.pubkey] ? <EyeOff ... /> : <Eye ... />}
    </button>
  </p>
)}
```

**File**: `src/client/routes/volunteers.tsx`

### 4. Login page backup file input uses unstyled native `<input type="file">`

**Problem**: The backup restore file input uses the browser's native file picker rendering. While the `file:` pseudo-element CSS makes the button look okay, the "No file chosen" text and overall appearance are inconsistent with the rest of the login form's polished custom components.

**Fix**: Replace with a styled drop zone / custom button pattern using a hidden file input and a visible Button component:

```tsx
<div className="space-y-2">
  <Label>{t('login.selectBackup')}</Label>
  <div
    className="flex items-center gap-3 rounded-lg border-2 border-dashed border-border p-4 transition-colors hover:border-primary/50 cursor-pointer"
    onClick={() => fileInputRef.current?.click()}
    onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-primary') }}
    onDragLeave={e => e.currentTarget.classList.remove('border-primary')}
    onDrop={handleDrop}
  >
    <Upload className="h-5 w-5 text-muted-foreground" />
    <div className="text-sm">
      {selectedFile ? (
        <span className="font-medium">{selectedFile.name}</span>
      ) : (
        <span className="text-muted-foreground">{t('login.dropOrChoose', { defaultValue: 'Drop a backup file here or click to browse' })}</span>
      )}
    </div>
    <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileSelect} className="hidden" />
  </div>
</div>
```

**File**: `src/client/routes/login.tsx`

### 5. Dashboard stat cards mix display and action

**Problem**: The three dashboard stat cards (Active Calls, Current Shift, Calls Today) are visually presented as equal status tiles, but the middle card (Current Shift) contains a "Take a Break" action button. This breaks the visual rhythm — the other two are pure displays while one is interactive.

**Fix**: Move the "Take a Break" / "End Break" button out of the stat card into a dedicated action bar below the stat cards. The shift card itself should show only the shift name/status.

```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
  {/* Active Calls card - display only */}
  {/* Current Shift card - display only (shift name + time) */}
  {/* Calls Today card - display only */}
</div>

{/* Shift action bar */}
<div className="flex items-center gap-3">
  {onBreak ? (
    <Button variant="outline" onClick={endBreak}>
      <Coffee className="mr-2 h-4 w-4" /> {t('dashboard.endBreak')}
    </Button>
  ) : (
    <Button variant="outline" onClick={takeBreak}>
      <Coffee className="mr-2 h-4 w-4" /> {t('dashboard.takeBreak')}
    </Button>
  )}
</div>
```

**File**: `src/client/routes/index.tsx`

### 6. Dark mode toggle verification

**Problem**: The dark mode toggle (system/light/dark icons) is present in the sidebar footer and on the login page. It works on the login page but needs verification across all authenticated pages. The toggle may not be applying the `dark` class correctly in all contexts, or CSS transitions may mask the change visually.

**Fix**: Audit the dark mode implementation:
- Verify the theme toggle in `__root.tsx` sidebar correctly sets `document.documentElement.classList`
- Check that all pages use Tailwind `dark:` variants properly (not hardcoded light colors)
- Ensure the theme persists across SPA navigation
- Add E2E test coverage: toggle to dark mode on dashboard, navigate to other pages, verify dark class persists

**Files**: `src/client/routes/__root.tsx`, `src/client/lib/theme.ts` (or wherever theme logic lives)

## Testing

All changes are visual — update existing E2E tests that reference modified elements:
- Conversations: update tests that check page heading
- Reports: update empty state selectors
- Volunteers: verify phone display test still passes
- Login: update backup file interaction tests
- Dashboard: update "Take a Break" button locator

## Acceptance Criteria

- [ ] Every page has a consistent `Icon + h1` heading
- [ ] Empty states use the same card-based centered pattern across all pages
- [ ] No orphaned UI elements (eye icon without phone, "No file chosen" text)
- [ ] Login file picker has drag-and-drop support and styled appearance
- [ ] Dashboard stat cards are pure display; actions live separately
- [ ] All existing E2E tests pass after modifications
