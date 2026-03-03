# Epic 231: Shared BDD Spec Consolidation

## Goal

Promote Android-only BDD features to shared `packages/test-specs/features/`, expand shared scenarios to cover gaps identified in the desktop spec suite, and ensure platform tags are accurate across all 75+ feature files. This epic is the foundation for Epic 232 (desktop spec→BDD migration) — shared scenarios must exist before desktop steps can implement them.

## Context

Current state:
- **Shared specs**: 75 feature files, 360 scenarios (358 Scenario + 2 Scenario Outline) in `packages/test-specs/features/`
- **Android-only**: 5 feature files exist in `apps/android/app/src/androidTest/assets/features/` but not in the shared `packages/test-specs/features/` directory (calls-today, language-selection, note-thread, shift-detail, volunteer-profile)
- **Desktop gaps**: roles.spec.ts has 27 tests vs 8 BDD scenarios, messaging-epics.spec.ts has 20 tests vs 11 BDD scenarios, device-linking.spec.ts has 10 tests vs 6 BDD scenarios, etc.
- **Tag inconsistencies**: Some features missing platform tags; most shared features already correctly tagged `@android @ios @desktop`

## Deliverables

### Phase 1: Promote Android-Only Features (5 files)

Move these features from Android-only to shared `packages/test-specs/features/`:

1. **`calls-today.feature`** → `packages/test-specs/features/dashboard/calls-today.feature`
   - 2 scenarios: display count, refresh updates count
   - Tags: `@android @ios @desktop`

2. **`language-selection.feature`** → `packages/test-specs/features/settings/language-selection.feature`
   - 5 scenarios: section visible, chips display, select language, spoken languages visible, toggle spoken language
   - Tags: `@android @ios @desktop`

3. **`note-thread.feature`** → `packages/test-specs/features/notes/note-thread.feature`
   - 5 scenarios: thread section visible, empty placeholder, reply count, input/send, reply badge
   - Tags: `@android @ios @desktop`

4. **`shift-detail.feature`** → `packages/test-specs/features/shifts/shift-detail.feature`
   - 5 scenarios: navigate to detail, info card, volunteer assignments, toggle assignment, navigate back
   - Tags: `@android @ios @desktop`
   - **Note**: Android has this under `admin/shift-detail.feature` — when promoting to shared, the canonical path is `shifts/`. Update the Android `assets/features/` mirror to match (move from `admin/` to `shifts/` subdirectory) so the Cucumber runner path stays in sync.

5. **`volunteer-profile.feature`** → `packages/test-specs/features/admin/volunteer-profile.feature`
   - 5 scenarios: navigate to profile, info card, join date, recent activity, navigate back
   - Tags: `@android @ios @desktop`

**Total promoted: 22 scenarios**

### Phase 2: Expand Shared Scenarios for Desktop Coverage Gaps

Add scenarios to existing shared features to cover tests currently only in `.spec.ts` files. This enables Epic 232 to delete spec files after BDD steps are implemented.

#### `admin/roles.feature` — Add 19 scenarios (currently 8)

```gherkin
# Add to existing roles.feature:

Scenario: Reject duplicate role slug
  When I create a custom role with an existing slug
  Then I should see a duplicate slug error

Scenario: Reject invalid slug format
  When I create a role with slug "Invalid Slug!"
  Then I should see an invalid slug error

Scenario: Update custom role permissions
  Given a custom role "Call Monitor" exists
  When I update the role permissions
  Then the permissions should be updated

Scenario: Fetch permissions catalog
  When I request the permissions catalog
  Then I should see all available permissions grouped by domain

Scenario: Admin can access all endpoints
  Given I am logged in as an admin
  Then I should have access to all API endpoints

Scenario: Volunteer cannot access admin endpoints
  Given I am logged in as a volunteer
  When I attempt to access an admin endpoint
  Then I should receive a 403 forbidden response

Scenario: Reporter cannot access call endpoints
  Given I am logged in as a reporter
  When I attempt to access call-related endpoints
  Then I should receive a 403 forbidden response

Scenario: Multi-role user gets union of permissions
  Given a volunteer has both "Volunteer" and "Reviewer" roles
  When the volunteer logs in
  Then they should have permissions from both roles

Scenario: Custom role grants only specified permissions
  Given a volunteer has only a custom "Call Monitor" role
  When the volunteer logs in
  Then they should only see endpoints allowed by that role

Scenario: Custom role user cannot access unauthorized endpoints
  Given a volunteer has only a custom "Call Monitor" role
  When the volunteer attempts to access an unauthorized endpoint
  Then they should receive a 403 forbidden response

Scenario: Reporter sees reports UI only
  Given I am logged in as a reporter
  Then I should see the reports navigation
  And I should not see the calls navigation
  And I should not see the volunteers management

Scenario: Admin sees all navigation items
  Given I am logged in as an admin
  Then I should see all navigation items including admin

Scenario: Domain wildcard grants all domain permissions
  Given a role with "notes:*" wildcard permission
  When the user with that role logs in
  Then they should have all notes-related permissions

Scenario: Role selector shows all default roles
  When I view the volunteer list
  Then the role dropdown should show all default roles

Scenario: Change volunteer role via dropdown
  Given a volunteer with "Volunteer" role
  When I change their role to "Hub Admin" via the dropdown
  Then the volunteer should display the "Hub Admin" badge

Scenario: Hub Admin badge displays after role change
  Given I changed a volunteer's role to "Hub Admin"
  Then I should see the "Hub Admin" badge on their card

Scenario: Add Volunteer form shows available roles
  When I open the Add Volunteer form
  Then I should see all available roles in the form

Scenario: Invite form shows available roles
  When I open the Invite form
  Then I should see all available roles in the form

Scenario: Delete non-existent role returns error
  When I attempt to delete a role that does not exist
  Then I should receive a not found error
```

#### `messaging/conversations-full.feature` — Add 9 scenarios (currently 7)

```gherkin
# Add to existing feature:

Scenario: Messaging admin settings section displays
  Given I am on the admin settings page
  Then I should see the messaging configuration section

Scenario: Configure SMS channel settings
  Given I am on the messaging settings
  When I configure SMS channel with Twilio credentials
  Then the SMS channel should be enabled

Scenario: Configure WhatsApp channel settings
  Given I am on the messaging settings
  When I configure WhatsApp channel
  Then the WhatsApp channel should be enabled

Scenario: Send outbound message in conversation
  Given I have an active conversation
  When I type a message and click send
  Then the message should appear in the thread

Scenario: Message delivery status updates
  Given I sent a message in a conversation
  Then I should see the delivery status indicator

Scenario: Close and reopen a conversation
  Given I have an active conversation
  When I close the conversation
  Then the conversation status should be "closed"
  When I reopen the conversation
  Then the conversation status should be "active"

Scenario: Conversation assignment to volunteer
  Given I have an unassigned conversation
  When I assign it to a volunteer
  Then the volunteer name should appear on the conversation

Scenario: Auto-assign balances load across volunteers
  Given multiple volunteers are available
  When a new conversation arrives
  Then it should be assigned to the volunteer with lowest load

Scenario: Filter conversations by channel type
  Given conversations exist across SMS and WhatsApp
  When I filter by SMS channel
  Then I should only see SMS conversations
```

#### `settings/device-link.feature` — Add 4 scenarios (currently 6)

```gherkin
# Add to existing feature:

Scenario: Device link shows QR code
  When I start the device linking process
  Then I should see a QR code displayed

Scenario: Device link shows progress steps
  When I start the device linking process
  Then I should see the linking progress indicator

Scenario: Cancel device linking
  When I start the device linking process
  And I cancel the linking
  Then I should return to the settings screen

Scenario: Device link timeout handling
  When I start the device linking process
  And the provisioning room expires
  Then I should see a timeout error message
```

#### `desktop/admin/multi-hub.feature` — Add 1 scenario (currently 5)

```gherkin
# Add to existing feature (note: "Create a new hub" already exists — this adds a tab navigation scenario):

Scenario: Hub settings show all configuration tabs
  Given I have selected a hub
  When I open hub settings
  Then I should see telephony, messaging, and general tabs
```

**Note**: "Create new hub with required fields" is NOT added — the existing "Create a new hub" scenario already covers hub creation. If more detail is needed (description field), expand the existing scenario's steps instead.

#### `help/help-screen.feature` — Add 4 scenarios (currently 5)

```gherkin
# Add to existing feature:

Scenario: Help page shows FAQ section
  When I navigate to the help page
  Then I should see the FAQ accordion

Scenario: Expand FAQ item shows answer
  Given I am on the help page
  When I click on a FAQ question
  Then the answer should be visible

Scenario: Help page shows getting started checklist
  When I navigate to the help page
  Then I should see the getting started checklist

Scenario: Getting started items link to relevant pages
  Given I am on the help page
  When I click a getting started item
  Then I should navigate to the relevant page
```

#### `desktop/calls/telephony-provider.feature` — Already has 5 scenarios covering test connection, invalid credentials, provider switching

The telephony-provider feature already covers the 5 key scenarios from the spec file. **No additional scenarios needed** — the existing BDD feature fully matches `telephony-provider.spec.ts` (10 tests, but many test individual field validation which is covered by the existing scenarios' step implementations).

### Phase 3: Tag Audit

Verify all feature files have correct platform tags:
- `@desktop` on all features that have desktop step implementations
- `@android` on all features that have Android step definitions
- `@ios` on features that iOS currently tests or should test
- `@smoke` on critical-path happy-path scenarios (login, dashboard, create note)
- `@regression` on edge cases and error scenarios

**Specific fixes needed:**
- Promoted features (5 files) need `@android @ios @desktop` tags
- Desktop-only features in `desktop/` subdirectory should have only `@desktop`
- Add `@backend` tag to new backend-specific features (Epic 233)
- Files already correctly tagged `@android @ios @desktop` (e.g., `help-screen.feature`) require no changes — skip during audit
- Near-duplicate scenarios (like multi-hub "Create a new hub") should be merged with existing rather than added separately

### Phase 4: Update validate-coverage.ts

Update `packages/test-specs/tools/validate-coverage.ts` to:
1. Count scenarios by platform tag
2. Report coverage percentages per platform
3. Warn on features missing platform tags
4. Validate no duplicate feature names across directories

## File Changes

### New files (5):
- `packages/test-specs/features/dashboard/calls-today.feature`
- `packages/test-specs/features/settings/language-selection.feature`
- `packages/test-specs/features/notes/note-thread.feature`
- `packages/test-specs/features/shifts/shift-detail.feature`
- `packages/test-specs/features/admin/volunteer-profile.feature`

### Modified files (7):
- `packages/test-specs/features/admin/roles.feature` (add 19 scenarios)
- `packages/test-specs/features/messaging/conversations-full.feature` (add 9 scenarios)
- `packages/test-specs/features/settings/device-link.feature` (add 4 scenarios)
- `packages/test-specs/features/desktop/admin/multi-hub.feature` (add 2 scenarios)
- `packages/test-specs/features/help/help-screen.feature` (add 4 scenarios)
- `packages/test-specs/features/desktop/calls/telephony-provider.feature` (add 5 scenarios)
- `packages/test-specs/tools/validate-coverage.ts` (tag audit + reporting)

## Verification

```bash
# Validate all features parse correctly
bun run test-specs:validate

# Count scenarios by platform
grep -r "@desktop" packages/test-specs/features/ | wc -l    # Should increase
grep -r "@android" packages/test-specs/features/ | wc -l    # Should increase by 22+
grep -r "@ios" packages/test-specs/features/ | wc -l        # Should increase by 22+

# No duplicate feature basenames
find packages/test-specs/features -name "*.feature" -exec basename {} \; | sort | uniq -d  # Should be empty
```

## Metrics

| Metric | Before | After |
|--------|--------|-------|
| Shared feature files | 75 | 80 (+5 promoted) |
| Shared scenarios | 360 | ~420 (+22 promoted, +38 expanded) |
| Android-only features | 5 | 0 |
| Desktop spec coverage gap | ~80 tests uncovered by BDD | ~10 tests uncovered (infrastructure-only) |

## Dependencies

- **Blocks**: Epic 232 (desktop spec→BDD migration needs these shared scenarios)
- **Blocks**: Epic 234 (iOS expansion uses these shared scenarios)
- **No blockers**: Can start immediately
