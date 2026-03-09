@backend @desktop @ios @android
Feature: Audit Log
  As an admin
  I want to view and verify the audit log
  So that I can track all actions and detect tampering

  # ── Backend: Audit Chain ──────────────────────────────────────────

  @backend
  Scenario: First audit entry has no previous hash
    Given an empty audit log
    When the first entry is added
    Then the entry hash should be computed
    And the previous entry hash should be null

  @backend
  Scenario: Subsequent entries chain to previous
    Given an audit log with 1 entry
    When a new entry is added
    Then the new entry should reference the previous entry hash

  @backend
  Scenario: Tampered event field breaks chain
    Given an audit log with 3 entries
    When the event field of entry 2 is modified
    Then chain verification should fail at entry 2

  @backend
  Scenario: Tampered actor field breaks chain
    Given an audit log with 3 entries
    When the actor field of entry 2 is modified
    Then chain verification should fail at entry 2

  @backend
  Scenario: Tampered timestamp breaks chain
    Given an audit log with 3 entries
    When the timestamp of entry 2 is modified
    Then chain verification should fail at entry 2

  @backend
  Scenario: Valid chain passes verification
    Given an audit log with 10 entries
    When the chain is verified
    Then all entries should pass integrity checks

  # ── Desktop/Mobile: Audit Log UI ──────────────────────────────────

  @desktop @ios @android
  Scenario: Audit log page loads with heading
    Given I am logged in as an admin
    When I navigate to the "Audit Log" page
    Then I should see the "Audit Log" heading

  @desktop @ios @android
  Scenario: Audit log shows entries after admin actions
    Given I am logged in as an admin
    And I have created a volunteer
    When I navigate to the "Audit Log" page
    Then I should see "Volunteer Added"

  @desktop @ios @android
  Scenario: Entries show timestamps
    Given I am logged in as an admin
    And I have created a volunteer
    When I navigate to the "Audit Log" page
    Then audit entries should be visible with date information

  @desktop @ios @android
  Scenario: Audit entry actors are displayed as links
    Given I am logged in as an admin
    And I have created a volunteer
    When I navigate to the "Audit Log" page
    Then audit entries should show actor links pointing to volunteer profiles

  @desktop @ios @android
  Scenario: Volunteer sees access denied on audit page
    Given I am logged in as an admin
    And a volunteer exists
    When the volunteer logs in and navigates to "/audit"
    Then they should see "Access Denied"

  @desktop @ios @android
  Scenario: Multiple action types appear
    Given I am logged in as an admin
    And I have created and then deleted a volunteer
    When I navigate to the "Audit Log" page
    Then I should see "Volunteer Added"
    And I should see "Volunteer Removed"

  @desktop @ios @android
  Scenario: Filter bar is visible with all controls
    Given I am logged in as an admin
    When I navigate to the "Audit Log" page
    Then I should see a search input
    And I should see an "All Events" event type filter
    And I should see date range inputs

  @desktop @ios @android
  Scenario: Event type filter narrows results
    Given I am logged in as an admin
    And I have created a volunteer
    When I navigate to the "Audit Log" page
    And I filter by "Volunteers" event type
    Then I should see "Volunteer Added"
    When I filter by "Calls" event type
    Then "Volunteer Added" should not be visible

  @desktop @ios @android
  Scenario: Search filter works
    Given I am logged in as an admin
    And I have created a volunteer
    When I navigate to the "Audit Log" page
    And I search for "xyznonexistent999"
    Then "Volunteer Added" should not be visible

  @desktop @ios @android
  Scenario: Clear button resets all filters
    Given I am logged in as an admin
    When I navigate to the "Audit Log" page
    And I type "something" in the search input
    Then I should see a "Clear" button
    When I click "Clear"
    Then the search input should be empty
    And the "Clear" button should not be visible

  @desktop @ios @android
  Scenario: Event type badges use category colors
    Given I am logged in as an admin
    And I have created a volunteer
    When I navigate to the "Audit Log" page
    Then the "Volunteer Added" badge should have the purple color class
