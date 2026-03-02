@android @ios @smoke
Feature: Identity Creation & Onboarding
  As a new user
  I want to create a new identity
  So that I can use the app with a fresh keypair

  Background:
    Given the app is freshly installed
    And I am on the login screen

  Scenario: Create identity navigates to onboarding
    When I tap "Create New Identity"
    Then I should see the onboarding screen
    And I should see my generated nsec
    And I should see my generated npub
    And I should see the "I've Backed Up My Key" button

  Scenario: Create identity with hub URL stores it
    When I enter "https://hub.example.com" in the hub URL field
    And I tap "Create New Identity"
    Then I should see the onboarding screen
    And the hub URL should be persisted

  Scenario: Generated nsec has correct format
    When I tap "Create New Identity"
    Then the displayed nsec should start with "nsec1"
    And the displayed npub should start with "npub1"

  Scenario: Confirm backup navigates to PIN setup
    When I tap "Create New Identity"
    And I tap "I've Backed Up My Key"
    Then I should see the PIN setup screen
    And the title should say "Enter a PIN"
