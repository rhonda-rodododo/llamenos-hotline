@android @ios @regression
Feature: Lock & Logout
  As an authenticated user
  I want to lock or log out of the app
  So that I can secure my session

  Background:
    Given I am authenticated
    And I am on the settings screen

  Scenario: Lock app returns to PIN unlock
    When I tap "Lock App"
    Then I should see the PIN unlock screen
    And the crypto service should be locked

  Scenario: Logout shows confirmation dialog
    When I tap "Log Out"
    Then I should see the logout confirmation dialog
    And I should see "Confirm" and "Cancel" buttons

  Scenario: Cancel logout dismisses dialog
    When I tap "Log Out"
    And I tap "Cancel"
    Then the dialog should be dismissed
    And I should remain on the settings screen

  Scenario: Confirm logout clears identity
    When I tap "Log Out"
    And I tap "Confirm"
    Then I should return to the login screen
    And no stored keys should remain
    And the crypto service should be locked
