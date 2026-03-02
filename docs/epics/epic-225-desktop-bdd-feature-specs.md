# Epic 225: Desktop BDD Feature Specifications

## Overview

Write `.feature` files for all desktop-specific Playwright test scenarios that aren't covered by the shared 25 feature files. This creates the Gherkin specifications that `playwright-bdd` (Epic 226) will execute.

## Current State

- 25 shared `.feature` files cover auth, dashboard, notes, conversations, shifts, navigation, settings, admin, crypto (102 scenarios)
- 40 Playwright `.spec.ts` files contain 361+ tests, most without corresponding feature files
- Desktop has significantly more capabilities than mobile (volunteer CRUD, shift scheduling, ban management, telephony config, multi-hub, custom fields, etc.)

## Approach

Analyze each existing Playwright spec file, write corresponding `.feature` files with `@desktop` tags, and organize in `packages/test-specs/features/desktop/`. Scenarios that overlap with shared features use `@all` (already handled). New scenarios get `@desktop`.

## Feature File Inventory

### Volunteer Management (`desktop/volunteers/`)

**volunteer-crud.feature** — From `volunteer-flow.spec.ts` + `invite-onboarding.spec.ts`
```gherkin
@desktop
Feature: Volunteer CRUD
  Background:
    Given I am logged in as an admin
    And I navigate to the "Volunteers" page

  Scenario: Add a new volunteer
  Scenario: View volunteer nsec card after creation
  Scenario: Dismiss nsec card
  Scenario: Edit volunteer name
  Scenario: Edit volunteer phone
  Scenario: Deactivate a volunteer
  Scenario: Delete a volunteer
  Scenario: Search volunteers by name
  Scenario: Volunteer list shows role badges
  Scenario: Cannot add duplicate phone number
```

**invite-onboarding.feature** — From `invite-onboarding.spec.ts`
```gherkin
@desktop
Feature: Invite Onboarding
  Scenario: Generate invite link
  Scenario: Invite link contains correct URL
  Scenario: Volunteer redeems invite and creates identity
  Scenario: Expired invite shows error
  Scenario: Already-redeemed invite shows error
```

### Shift Management (`desktop/shifts/`)

**shift-scheduling.feature** — From `shift-management.spec.ts`
```gherkin
@desktop
Feature: Shift Scheduling
  Scenario: Create a new shift
  Scenario: Edit shift times
  Scenario: Delete a shift
  Scenario: Assign volunteer to shift
  Scenario: Remove volunteer from shift
  Scenario: Shift shows assigned volunteer count
  Scenario: Cannot create overlapping shifts
  Scenario: Weekly schedule displays correctly
  Scenario: Shift ring group configuration
  Scenario: Fallback ring group when no schedule
  Scenario Outline: Create shift with different day patterns
    Examples:
      | days |
      | Weekdays |
      | Weekends |
      | Every day |
```

### Ban Management (`desktop/bans/`)

**ban-management.feature** — From `ban-management.spec.ts`
```gherkin
@desktop
Feature: Ban Management
  Scenario: Add a phone number to ban list
  Scenario: Remove a ban
  Scenario: Search ban list
  Scenario: Ban shows reason and date
  Scenario: Bulk import bans
  Scenario: Cannot ban same number twice
  Scenario: Ban list pagination
```

### Notes & Custom Fields (`desktop/notes/`)

**notes-custom-fields.feature** — From `notes-custom-fields.spec.ts`
```gherkin
@desktop
Feature: Notes with Custom Fields
  Scenario: Note form shows custom fields
  Scenario: Fill text custom field
  Scenario: Select dropdown custom field
  Scenario: Toggle checkbox custom field
  Scenario: Custom fields saved with note
  Scenario: Custom fields displayed in note detail
```

**custom-fields-admin.feature** — From `custom-fields.spec.ts`
```gherkin
@desktop
Feature: Custom Fields Administration
  Scenario: Create a text field
  Scenario: Create a dropdown field with options
  Scenario: Create a checkbox field
  Scenario: Edit field label
  Scenario: Delete a custom field
  Scenario: Reorder custom fields
  Scenario: Field context filtering (call notes vs reports)
  Scenario: Field validation (required fields)
```

### Call Management (`desktop/calls/`)

**call-recording.feature** — From `call-recording.spec.ts`
```gherkin
@desktop
Feature: Call Recording
  Scenario: Call history shows recording badge
  Scenario: Play recording from call detail
  Scenario: Recording player controls
  Scenario: Call without recording shows no badge
```

**telephony-provider.feature** — From `telephony-provider.spec.ts`
```gherkin
@desktop
Feature: Telephony Provider Configuration
  Scenario: Display Twilio settings form
  Scenario: Save Twilio credentials
  Scenario: Test connection shows success
  Scenario: Invalid credentials show error
  Scenario: Switch between providers
```

### Messaging (`desktop/messaging/`)

**conversations-full.feature** — From `conversations.spec.ts` + `messaging-epics.spec.ts`
```gherkin
@desktop
Feature: Conversations (Desktop)
  Scenario: View conversation thread
  Scenario: Send a message in conversation
  Scenario: Conversation shows channel badge (SMS/WhatsApp/Signal)
  Scenario: Assign conversation to volunteer
  Scenario: Close a conversation
  Scenario: Reopen a closed conversation
  Scenario: Conversation search
```

**rcs-channel.feature** — From `rcs-channel.spec.ts`
```gherkin
@desktop
Feature: RCS Channel Configuration
  Scenario: RCS settings form displays
  Scenario: Save RCS configuration
  Scenario: RCS test message
```

### Admin & Audit (`desktop/admin/`)

**audit-log.feature** — From `audit-log.spec.ts`
```gherkin
@desktop
Feature: Audit Log
  Scenario: Audit log displays entries
  Scenario: Filter audit log by action type
  Scenario: Filter audit log by date range
  Scenario: Audit entry shows actor and timestamp
  Scenario: Hash chain integrity indicator
```

**multi-hub.feature** — From `multi-hub.spec.ts`
```gherkin
@desktop
Feature: Multi-Hub Management
  Scenario: Create a new hub
  Scenario: Switch between hubs
  Scenario: Hub settings display
  Scenario: Hub-specific volunteer list
  Scenario: Hub deletion confirmation
```

**roles.feature** — From `roles.spec.ts`
```gherkin
@desktop
Feature: Role Management
  Scenario: View available roles
  Scenario: Assign role to volunteer
  Scenario: Remove role from volunteer
  Scenario: Role permissions display
  Scenario: Custom role creation
```

**reports.feature** — From `reports.spec.ts`
```gherkin
@desktop
Feature: Reports
  Scenario: Create a report
  Scenario: Report list displays
  Scenario: Report detail view
  Scenario: Report custom fields
  Scenario: Report thread
```

### Settings (`desktop/settings/`)

**profile-settings.feature** — From `profile-settings.spec.ts`
```gherkin
@desktop
Feature: Profile Settings
  Scenario: Display profile information
  Scenario: Update display name
  Scenario: Update phone number
  Scenario: Profile shows role
```

**webrtc-settings.feature** — From `webrtc-settings.spec.ts`
```gherkin
@desktop
Feature: WebRTC Settings
  Scenario: WebRTC settings display
  Scenario: Toggle WebRTC calling
  Scenario: Audio device selection
```

### Miscellaneous (`desktop/misc/`)

**demo-mode.feature** — From `demo-mode.spec.ts`
```gherkin
@desktop
Feature: Demo Mode
  Scenario: Enable demo mode from setup wizard
  Scenario: Demo banner displayed
  Scenario: Demo data seeded
  Scenario: One-click demo login
  Scenario: Exit demo mode
```

**theme.feature** — From `theme.spec.ts`
```gherkin
@desktop
Feature: Theme
  Scenario: Toggle dark mode
  Scenario: Theme persists across reload
```

**panic-wipe.feature** — From `panic-wipe.spec.ts`
```gherkin
@desktop @smoke
Feature: Panic Wipe
  Scenario: Triple-Escape triggers panic wipe
  Scenario: Panic wipe clears all local data
  Scenario: Panic wipe redirects to login
```

**blasts.feature** — From `blasts.spec.ts`
```gherkin
@desktop
Feature: Message Blasts
  Scenario: Create a blast message
  Scenario: Blast recipient selection
  Scenario: Schedule a blast
  Scenario: Blast delivery status
  Scenario: Cancel scheduled blast
```

**form-validation.feature** — From `form-validation.spec.ts`
```gherkin
@desktop
Feature: Form Validation
  Scenario: Required fields show error
  Scenario: Phone format validation
  Scenario: URL format validation
```

**setup-wizard.feature** — From `setup-wizard.spec.ts`
```gherkin
@desktop
Feature: Setup Wizard
  Scenario: Wizard displays on first launch
  Scenario: Wizard step navigation
  Scenario: Complete wizard
```

**sidebar-navigation.feature** — From `smoke.spec.ts` + navigation portions
```gherkin
@desktop
Feature: Sidebar Navigation
  Scenario: Sidebar shows all navigation items
  Scenario: Navigate between sections via sidebar
  Scenario: Active section highlighted
  Scenario: Sidebar collapse/expand
  Scenario: Admin section visible for admins only
```

## Summary

| Directory | Feature Files | Scenarios (est.) |
|-----------|--------------|-----------------|
| `desktop/volunteers/` | 2 | 15 |
| `desktop/shifts/` | 1 | 13 |
| `desktop/bans/` | 1 | 7 |
| `desktop/notes/` | 2 | 14 |
| `desktop/calls/` | 2 | 9 |
| `desktop/messaging/` | 2 | 10 |
| `desktop/admin/` | 4 | 20 |
| `desktop/settings/` | 2 | 7 |
| `desktop/misc/` | 6 | 22 |
| **Total** | **22** | **~117** |

Combined with 25 shared features (102 scenarios tagged `@all`/`@mobile`), desktop total: ~220 scenarios.

## File Changes

### Created
- 22 new `.feature` files in `packages/test-specs/features/desktop/`

## Dependencies

- Epic 223 (platform tag system must be defined)

## Verification

```bash
# Count scenarios
grep -r "Scenario:" packages/test-specs/features/desktop/ | wc -l  # ~117

# All features parse correctly (no Gherkin syntax errors)
bun run test-specs:validate --check-syntax
```
