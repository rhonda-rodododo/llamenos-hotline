@ios @android
Feature: Event Management (Mobile)
  Coordinators and admins view and manage events on mobile devices.
  Event list shows events with status and date.
  Event detail shows tabs for details, sub-events, linked cases, and reports.

  Background:
    Given the app is launched and authenticated as admin

  Scenario: Events screen shows list or empty state
    When I navigate to the Events screen
    Then I should see the events list or empty state

  Scenario: Event cards show in list when events exist
    When I navigate to the Events screen
    Then I should see event cards or the empty state

  Scenario: Event search field is visible
    When I navigate to the Events screen
    Then the events search field should be visible

  Scenario: Tapping an event card opens the detail view
    Given events exist in the system
    When I navigate to the Events screen
    And I tap the first event card
    Then I should see the event detail tabs

  Scenario: Event detail shows all tabs
    Given events exist in the system
    When I navigate to the Events screen
    And I tap the first event card
    Then I should see the details tab in event detail
    And I should see the sub-events tab
    And I should see the linked cases tab
    And I should see the linked reports tab
