@android @ios @desktop @regression
Feature: Key Import
  As an existing user
  I want to import my nsec on a new device
  So that I can use the same identity

  Background:
    Given the app is freshly installed
    And I am on the login screen

  Scenario: Import valid nsec logs in successfully
    When I enter a valid 63-character nsec
    And I tap "Log in"
    Then I should be redirected away from login

  Scenario: Error clears when typing in nsec field
    When I tap "Log in"
    And I should see an error message
    And I start typing in the nsec field
    Then the error should disappear
