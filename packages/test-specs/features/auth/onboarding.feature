@android @ios @desktop @smoke
Feature: Identity Creation & Onboarding
  As a new user
  I want to log in with my nsec
  So that I can start using the app

  Background:
    Given the app is freshly installed
    And I am on the login screen

  Scenario: Valid nsec login navigates to dashboard
    When I enter a valid 63-character nsec
    And I tap "Log in"
    Then I should be redirected away from login

  Scenario: Nsec field shows password type
    When I enter "nsec1test" in the nsec field
    Then the nsec field should be a password field

  Scenario: Link device button is visible
    Then I should see a "Link this device" button
