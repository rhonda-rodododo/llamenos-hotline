@ios @android
Feature: Hub Management (Mobile)
  Admins view and manage hubs from the settings screen.
  Hub list shows connected hubs with active indicator and details.

  Background:
    Given the app is launched

  Scenario: Hub management is accessible from settings
    When I navigate to hub management
    Then I should see the hubs screen

  Scenario: Hub list shows hub cards
    When I navigate to hub management
    Then I should see hub cards or the empty state

  Scenario: Active hub has indicator
    When I navigate to hub management
    Then the active hub should have an indicator

  Scenario: Create hub button is visible
    When I navigate to hub management
    Then the create hub button should be visible
