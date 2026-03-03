@android @ios @desktop @regression
Feature: Key Import
  As an existing user
  I want to import my nsec from another device
  So that I can use the same identity on this device

  Background:
    Given the app is freshly installed
    And I am on the login screen

  Scenario: Import valid nsec and set PIN
    When I enter "https://hub.example.com" in the hub URL field
    And I enter a valid 63-character nsec
    And I tap "Import Key"
    And I enter PIN "5678"
    And I confirm PIN "5678"
    Then I should arrive at the dashboard
    And the hub URL should be stored as "https://hub.example.com"

  Scenario: Import without hub URL still works
    When I enter a valid 63-character nsec
    And I tap "Import Key"
    And I enter PIN "1234"
    And I confirm PIN "1234"
    Then I should arrive at the dashboard

  Scenario: Error clears when typing in nsec field
    When I tap "Import Key"
    And I see the error "Please enter your nsec"
    And I start typing in the nsec field
    Then the error should disappear
