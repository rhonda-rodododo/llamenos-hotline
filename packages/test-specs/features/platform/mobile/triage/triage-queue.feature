@ios @android
Feature: Triage Queue (Mobile)
  Admins triage incoming reports by reviewing content,
  filtering by status, and converting reports to case records.

  Background:
    Given the app is launched and authenticated as admin

  Scenario: Triage screen shows reports or empty state
    When I navigate to the Triage screen
    Then I should see the triage list or empty state

  Scenario: Triage report cards show in list when reports exist
    When I navigate to the Triage screen
    Then I should see triage cards or the empty state

  Scenario: Triage filter chips are visible
    When I navigate to the Triage screen
    Then the triage filter chips should be visible

  Scenario: Tapping a triage report opens the detail view
    Given triage-eligible reports exist
    When I navigate to the Triage screen
    And I tap the first triage report card
    Then I should see the triage detail view
    And the triage report title should be visible
    And the triage report status should be visible

  Scenario: Convert to case button visible in triage detail
    Given triage-eligible reports exist
    When I navigate to the Triage screen
    And I tap the first triage report card
    Then the convert to case button should be visible

  Scenario: Tapping convert to case shows confirmation
    Given triage-eligible reports exist
    When I navigate to the Triage screen
    And I tap the first triage report card
    And I tap the convert to case button
    Then the convert confirmation dialog should appear
