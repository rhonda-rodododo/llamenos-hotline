@android @ios @desktop @smoke
Feature: Login Screen
  As a new user
  I want to see the login screen
  So that I can log in or recover my identity

  Background:
    Given the app is freshly installed
    And no identity exists on the device

  Scenario: Login screen displays recovery elements
    When the app launches
    Then I should see the nsec import input field
    And I should see a "Log in" button

  Scenario: Nsec input is password-masked
    When I enter "nsec1test" in the nsec field
    Then the nsec field should be a password field

  @regression
  Scenario: Login with empty nsec shows error
    When I tap "Log in" without entering an nsec
    Then I should see an error message
    And I should remain on the login screen

  @regression
  Scenario: Login with invalid nsec shows error
    When I enter "not-a-valid-nsec" in the nsec field
    And I tap "Log in"
    Then I should see an error message
    And I should remain on the login screen

  @regression
  Scenario: Login with valid nsec navigates away from login
    When I enter a valid 63-character nsec
    And I tap "Log in"
    Then I should be redirected away from login
