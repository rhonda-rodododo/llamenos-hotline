@android @ios @smoke
Feature: Settings Screen
  As an authenticated user
  I want to access my settings
  So that I can view my identity, manage my session, and access admin features

  Background:
    Given I am authenticated and on the main screen

  Scenario: Settings tab displays identity card
    When I tap the "Settings" tab
    Then I should see the identity card
    And I should see my npub in monospace text
    And I should see the copy npub button

  Scenario: Settings shows hub connection info
    When I tap the "Settings" tab
    Then I should see the hub connection card
    And the connection status should be displayed

  Scenario: Settings shows device link card
    When I tap the "Settings" tab
    Then I should see the device link card (may need scroll)
    And the device link card should be tappable

  Scenario: Settings shows admin card
    When I tap the "Settings" tab
    Then I should see the admin card (may need scroll)
    And the admin card should be tappable

  Scenario: Settings shows lock and logout buttons
    When I tap the "Settings" tab
    Then I should see the "Lock App" button
    And I should see the "Log Out" button

  Scenario: Settings shows version text
    When I tap the "Settings" tab
    Then I should see the version text
