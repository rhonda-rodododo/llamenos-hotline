# Case Management System — Frontend Design Document

**Date**: 2026-03-14
**Status**: DRAFT
**Platforms**: Desktop (Tauri v2 + React + shadcn/ui), Mobile (iOS SwiftUI, Android Compose — limited)
**Design Philosophy**: Powerful for coordinators, effortless for volunteers, privacy-visible everywhere

---

## Design Principles

### 1. Progressive Disclosure
- **First-time volunteer** sees a clean, single-purpose form: "New Arrest Case" with just the required fields
- **Coordinator** sees the full dashboard: filterable case list, bulk actions, keyboard shortcuts
- **Admin** unlocks the schema editor, template browser, and role configuration
- Complexity reveals itself as the user's role demands it — never before

### 2. Privacy as UI
- Every encrypted field shows a subtle **lock icon** — users see the system protecting data
- PII fields the user can't decrypt show a **frosted glass blur** with "Restricted" label — reinforcing zero-knowledge even from other team members
- Search explains itself: "Searching encrypted indexes..." brief indicator
- Encryption tier badges on records: a small shield icon with tier indicator

### 3. Crisis-Speed UX
- Case creation in **under 30 seconds** during mass arrest: template pre-fills statuses and fields, volunteer just enters the unique details
- **Keyboard-first**: Tab through fields, Ctrl+Enter to save, Ctrl+K for command palette
- **Screen pop on calls**: When a call comes in, the matching contact's case history slides in from the right — no navigation needed
- Status changes are **one-click**: colored status pills that cycle on click (with confirmation for critical statuses like "Released")

### 4. Density Control
- Default: **comfortable** spacing (volunteers, occasional users)
- Coordinator mode: **compact** density — more rows visible, smaller cards, condensed tables
- Toggle in user preferences, persisted locally

---

## Color System

### Semantic Colors (extend existing shadcn theme)

```css
/* Status colors — from entity type definitions, not hardcoded */
--status-reported: #f59e0b;    /* amber — needs attention */
--status-confirmed: #3b82f6;   /* blue — verified */
--status-in-custody: #ef4444;  /* red — urgent/active */
--status-arraigned: #8b5cf6;   /* purple — legal process */
--status-released: #22c55e;    /* green — positive outcome */
--status-closed: #6b7280;      /* gray — archived */

/* Severity — universal triage */
--severity-urgent: #ef4444;
--severity-standard: #3b82f6;
--severity-low: #6b7280;

/* Triage (street medic) */
--triage-green: #22c55e;
--triage-yellow: #f59e0b;
--triage-red: #ef4444;
--triage-black: #000000;

/* Encryption tiers */
--tier-summary: #3b82f6;       /* blue — shared */
--tier-fields: #8b5cf6;        /* purple — assigned */
--tier-pii: #ef4444;           /* red — restricted */
```

All colors come from `EntityTypeDefinition.statuses[].color` at runtime — not hardcoded in components. The UI is fully theme-driven by the schema.

---

## Navigation Structure

### Sidebar (Desktop)

```
📞 Dashboard
├── 📋 Cases                    ← NEW (dynamic entity type sub-links)
│   ├── All Cases
│   ├── Arrest Cases (JS)       ← from EntityTypeDefinition where showInNavigation
│   ├── Medical Encounters (ME)
│   └── + More types...
├── 👥 Contact Directory        ← NEW
├── 📅 Events                   ← NEW
├── 📝 Notes
├── 💬 Conversations
├── 📊 Reports
├── 📞 Calls
├── 📢 Blasts
├── 🚫 Bans
├── ⏰ Shifts
└── ⚙️ Settings
    ├── ...existing...
    └── Case Management         ← NEW (schema editor, templates)
```

The Cases section is **dynamic** — entity types with `showInNavigation: true` generate sidebar links automatically. When a template is applied, new links appear without code changes.

---

## Component Architecture

### Core Reusable Components

#### 1. SchemaForm — The Heart of the System

The schema-driven form renderer. Takes an `EntityTypeDefinition` and renders fields dynamically:

```
SchemaForm
├── renders field.section groups as collapsible panels
├── for each field in section:
│   ├── text → Input
│   ├── textarea → Textarea
│   ├── number → Input[type=number]
│   ├── select → Select with options from field.options
│   ├── multiselect → MultiSelect (checkboxes in popover)
│   ├── checkbox → Switch
│   ├── date → DatePicker (with time)
│   └── file → FileUpload
├── showWhen logic: evaluates field.showWhen against current form values
│   → hidden fields animate in/out with height transition
├── accessLevel display:
│   ├── 'all' → normal render
│   ├── 'assigned' → subtle "Assigned+" indicator
│   ├── 'admin' → lock icon + "Admin only" badge
│   └── field user can't decrypt → frosted blur + "Restricted"
└── validation: required, min/max, pattern from field.validation
```

**Props**: `entityType: EntityTypeDefinition, values: Record<string, unknown>, onChange, readOnly?, showAccessIndicators?`

Used in: CreateRecordWizard, RecordDetailPage (edit mode), ContactForm

#### 2. StatusPill — Quick Status Display & Change

A colored pill showing the current status. Click cycles through available statuses (with confirmation for closed statuses):

```
[● Reported] → click → [● Confirmed] → click → [● In Custody] → ...
```

Colors and labels come from `EntityTypeDefinition.statuses[]`. The pill animates color transitions.

#### 3. EncryptionBadge — Tier Indicator

Small shield icon showing the encryption tier of a field or record:
- 🔵 Summary (shared with team)
- 🟣 Fields (assigned + admins)
- 🔴 PII (admins only)

Tooltip explains who can decrypt.

#### 4. BlindSearchBar — Privacy-Aware Search

Search input that:
1. Shows "Searching encrypted indexes..." while computing blind hashes client-side
2. Sends only hashed tokens to server
3. Decrypts matching results client-side
4. For name search: generates trigram tokens, shows partial matches

---

## Page Designs

### Cases List Page (`/cases`)

```
┌──────────────────────────────────────────────────────────────┐
│ Cases                                            [+ New Case]│
│                                                               │
│ [All] [Arrest Cases] [Medical] [Custom...]   ← entity type tabs
│                                                               │
│ ┌─ Filters ─────────────────────────────────────────────────┐│
│ │ Status: [Any ▾]  Severity: [Any ▾]  Assigned: [Any ▾]   ││
│ │ Date range: [From] → [To]   [Clear filters]              ││
│ └───────────────────────────────────────────────────────────┘│
│                                                               │
│ ┌─────┬──────────┬──────────┬─────────┬──────────┬─────────┐│
│ │  □  │ Case #   │ Status   │ Contact │ Assigned │ Updated ││
│ ├─────┼──────────┼──────────┼─────────┼──────────┼─────────┤│
│ │  □  │ JS-0042  │ ●InCust  │ Carlos  │ Maria V  │ 2m ago  ││
│ │  □  │ JS-0041  │ ●Report  │ 🔒      │ —        │ 15m ago ││
│ │  □  │ JS-0040  │ ●Releas  │ Ana R.  │ Maria V  │ 1h ago  ││
│ │  □  │ ME-0003  │ ●Triagd  │ Unknown │ Dr. Kim  │ 3m ago  ││
│ └─────┴──────────┴──────────┴─────────┴──────────┴─────────┘│
│                                                               │
│ ┌─ Bulk Actions (when selected) ─────────────────────────────│
│ │ 3 selected: [Change Status ▾] [Assign ▾] [Export]        ││
│ └───────────────────────────────────────────────────────────┘│
│                                                               │
│ Page 1 of 23  ← [Prev] [Next] →              Showing 50/1127│
└──────────────────────────────────────────────────────────────┘
```

**Key interactions**:
- Entity type tabs filter the list to a single type — URL updates to `/cases?type=arrest_case`
- Status/severity filters use blind index hashes — server filters, client decrypts results
- Checkbox multi-select enables bulk actions toolbar (sticky at bottom)
- Case number is a link to detail page
- Contact name shows 🔒 if user can't decrypt PII tier
- "2m ago" relative timestamps update via interval

### Record Detail Page (`/cases/:id`)

```
┌──────────────────────────────────────────────────────────────┐
│ ← Back to Cases                                              │
│                                                               │
│ ┌─ Header ──────────────────────────────────────────────────┐│
│ │ JS-2026-0042    [● In Custody]   ⚠ Urgent                ││
│ │ Arrest Case     Created: 3/14 2:30pm  by Maria V.        ││
│ │                                                            ││
│ │ [Change Status ▾] [Assign ▾] [Link Contact] [⋮ More]     ││
│ └────────────────────────────────────────────────────────────┘│
│                                                               │
│ [Details] [Timeline] [Contacts] [Evidence] [Related]          │
│                                                               │
│ ┌─ Details Tab (SchemaForm) ────────────────────────────────┐│
│ │                                                            ││
│ │ ── Arrest Details ──────────────────────────               ││
│ │ Arrest Date/Time: [2026-03-14 14:30]                      ││
│ │ Location:         [5th Ave & Main St]                     ││
│ │ Arresting Agency: [Local PD ▾]                            ││
│ │ Officers:         [Badge #4521, #4522]                    ││
│ │                                                            ││
│ │ ── Legal ────────────────────────────────                  ││
│ │ Charges:          [Disorderly conduct, resisting]         ││
│ │ Charge Severity:  [Misdemeanor ▾]                         ││
│ │ Attorney Status:  [Needs Attorney ▾]  🔵                  ││
│ │ Attorney Name:    [🔒 Restricted]     🔴                  ││
│ │                                                            ││
│ │ ── Flags ────────────────────────────────                  ││
│ │ ☑ Medical Needs    Medical Details: [Asthma, needs...]    ││
│ │ ☐ Minor            ☑ Immigration Hold Risk  🔴            ││
│ │                                                            ││
│ │ ── Court ────────────────────────────────                  ││
│ │ Next Court Date:   [2026-04-01]                           ││
│ │ Courtroom:         [Part B, Room 412]                     ││
│ │ Court History:     [3/15 — Arraigned, continued...]       ││
│ │                                                            ││
│ └────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

**Schema-driven rendering**: Sections come from `field.section`, field order from `field.order`. The `showWhen` rules hide "Attorney Name" until attorney status is set. Encryption badges (🔵🔴) show access tier. Frosted "Restricted" fields indicate the user lacks the PII envelope.

### Timeline Tab

```
┌─ Timeline ──────────────────────────────────────────────────┐
│ [Newest first ▾]  [All types ▾]                             │
│                                                              │
│ ◉ 3:15 PM — Status changed                                 │
│ │  Maria V. changed status: Reported → In Custody           │
│ │                                                            │
│ ◉ 3:10 PM — Note linked                                    │
│ │  "Arrested at 5th & Main, badge #4521. Complained of..."  │
│ │  [View full note →]                                        │
│ │                                                            │
│ ◉ 2:45 PM — Call linked                                    │
│ │  Incoming call from +1 (555) ****1234 — Duration: 4:32   │
│ │                                                            │
│ ◉ 2:30 PM — Case created                                   │
│ │  Created by Maria V. during active call                    │
│                                                              │
│ ┌─ Add comment... ─────────────────────── [Post] ┐          │
│ │                                                  │          │
│ └──────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────┘
```

### Contact Directory (`/contacts-directory`)

```
┌──────────────────────────────────────────────────────────────┐
│ Contact Directory                          [+ New Contact]   │
│                                                               │
│ 🔍 [Search contacts...          ]  Searching encrypted data  │
│                                                               │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│ │ 👤 Carlos M. │ │ 👤 Maria G.  │ │ 👤 🔒       │          │
│ │ Arrestee     │ │ Attorney     │ │ (Restricted) │          │
│ │ 3 cases      │ │ 12 cases     │ │ 1 case       │          │
│ │ Last: 2m ago │ │ Last: 1h ago │ │ Last: 3d ago │          │
│ └──────────────┘ └──────────────┘ └──────────────┘          │
│                                                               │
│ [Show: All ▾]  [Type: Any ▾]  [Tags: Any ▾]                │
└──────────────────────────────────────────────────────────────┘
```

Contacts the user can't decrypt show a locked card. The search bar generates trigram blind indexes client-side before querying.

### Template Browser (Admin)

```
┌──────────────────────────────────────────────────────────────┐
│ Case Management Settings                                      │
│                                                               │
│ [Entity Types] [Relationships] [Templates]                    │
│                                                               │
│ ┌─ Templates ───────────────────────────────────────────────┐│
│ │                                                            ││
│ │ ┌─────────────────┐  ┌─────────────────┐                 ││
│ │ │ ⚖️ Jail Support  │  │ 🩺 Street Medic │                 ││
│ │ │ 2 entity types   │  │ 1 entity type    │                 ││
│ │ │ 37 fields        │  │ 13 fields        │                 ││
│ │ │ 4 suggested roles│  │ 3 suggested roles│                 ││
│ │ │ v1.1.0           │  │ v1.1.0           │                 ││
│ │ │ [Apply →]        │  │ [Apply →]        │                 ││
│ │ └─────────────────┘  └─────────────────┘                  ││
│ │                                                            ││
│ │ ┌─────────────────┐  ┌─────────────────┐                 ││
│ │ │ 📞 General      │  │ 🧊 ICE Response  │                 ││
│ │ │ 1 entity type    │  │ (coming soon)    │                 ││
│ │ │ 7 fields         │  │                  │                 ││
│ │ │ [Apply →]        │  │                  │                 ││
│ │ └─────────────────┘  └─────────────────┘                  ││
│ └────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## Mobile Design (Limited — Jail Support Volunteers)

### iOS / Android — Field Volunteer View

Mobile clients get a **read-heavy, update-light** interface for jail support field work:

#### Screens:
1. **Case List** — simplified list with case number, status pill, contact name, last updated
2. **Case Summary** — read-only view of summary-tier fields (status, charges, attorney status, next court date)
3. **Quick Status Update** — tap status pill → select new status → confirm
4. **Court Date Viewer** — filtered view showing all cases with upcoming court dates
5. **Add Comment** — text input → encrypt → POST interaction

#### NOT on mobile:
- Schema editor / template browser (admin-only, desktop)
- Contact directory (too complex for field work)
- Evidence upload (large files, chain of custody — desktop)
- Bulk operations (needs multi-select, difficult on touch)
- Relationship graph (visualization requires screen space)

#### Mobile UX Principles:
- **Large touch targets** — minimum 48px
- **Offline queue** — status updates and comments queued when offline, synced when connected
- **Pull to refresh** — standard pattern for case list
- **Swipe actions** — swipe right to change status, swipe left to add comment

---

## Performance Strategy for 1000+ Cases

1. **Server-side blind index filtering** — only matching records returned (not all 1000+)
2. **Pagination**: 50 records per page, cursor-based
3. **Lazy tab loading**: Timeline, Evidence, Related tabs fetch on first click
4. **Virtual scrolling**: Case list uses virtualization for 500+ visible rows
5. **Debounced search**: 300ms debounce on search input before computing trigram hashes
6. **Optimistic updates**: Status changes show immediately, revert on error
7. **Background decryption**: Records decrypt in batches of 10, showing skeleton loading
8. **IndexedDB cache**: Decrypted record summaries cached locally for instant re-display

---

## Accessibility

- All interactive elements have `data-testid` for Playwright E2E tests
- ARIA labels on status pills, encryption badges, search indicators
- Keyboard navigation: Tab order follows visual layout, Escape closes modals
- Screen reader announcements for status changes and encryption state
- High contrast mode respects system preference
- Minimum 4.5:1 contrast ratio for all text
