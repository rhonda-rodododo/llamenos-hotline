@ios @android
Feature: Active Call Actions (Mobile)
  During an active call, volunteers see the active call card on the dashboard
  with hangup, ban+hangup, report spam, and quick note actions.

  Background:
    Given the app is launched and authenticated as admin
    And an active call exists

  Scenario: Active call card is visible on the dashboard
    Then I should see the active call card

  Scenario: Hangup button ends the call
    When I tap the hangup button
    Then the active call card should disappear

  Scenario: Ban + hangup shows reason dialog
    When I tap the ban and hangup button
    Then the ban dialog should appear
    And the ban reason input should be visible
    And the ban confirm button should be visible

  Scenario: Report spam button is visible
    Then the report spam button should be visible on the call card

  Scenario: Quick note button is visible
    Then the quick note button should be visible on the call card
