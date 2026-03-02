@android @ios @desktop @smoke
Feature: Login Screen
  As a new user
  I want to see the login screen
  So that I can create or import my identity

  Background:
    Given the app is freshly installed
    And no identity exists on the device

  Scenario: Login screen displays all required elements
    When the app launches
    Then I should see the app title "Llámenos"
    And I should see the hub URL input field
    And I should see the nsec import input field
    And I should see the "Create New Identity" button
    And I should see the "Import Key" button

  Scenario: Hub URL input accepts and displays text
    When I enter "https://hub.example.com" in the hub URL field
    Then the hub URL field should contain "https://hub.example.com"

  Scenario: Nsec input is password-masked
    When I enter "nsec1test" in the nsec field
    Then the nsec field should be a password field

  @regression
  Scenario: Import key with empty nsec shows error
    When I tap "Import Key" without entering an nsec
    Then I should see the error "Please enter your nsec"
    And I should remain on the login screen

  @regression
  Scenario: Import key with invalid nsec shows error
    When I enter "not-a-valid-nsec" in the nsec field
    And I tap "Import Key"
    Then I should see an error message
    And I should remain on the login screen

  @regression
  Scenario: Import key with valid nsec navigates to PIN setup
    When I enter a valid 63-character nsec
    And I tap "Import Key"
    Then I should see the PIN setup screen
