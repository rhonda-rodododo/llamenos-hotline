@android @ios @smoke
Feature: PIN Setup
  As a new user completing onboarding
  I want to set a PIN to protect my identity
  So that my private key is encrypted at rest

  Background:
    Given I have created a new identity
    And I have confirmed my nsec backup
    And I am on the PIN setup screen

  Scenario: PIN pad displays correctly
    Then I should see the PIN pad with digits 0-9
    And I should see the backspace button
    And I should see the PIN dots indicator
    And the title should say "Enter a PIN"

  Scenario: Entering 4 digits moves to confirmation
    When I enter PIN "1234"
    Then the title should change to "Confirm your PIN"
    And the PIN dots should be cleared

  Scenario: Matching confirmation completes setup
    When I enter PIN "1234"
    And I confirm PIN "1234"
    Then I should arrive at the dashboard
    And the dashboard title should be displayed
    And the bottom navigation should be visible

  Scenario: Mismatched confirmation shows error
    When I enter PIN "1234"
    And I confirm PIN "5678"
    Then I should see a PIN mismatch error
    And I should remain on the PIN confirmation screen

  @regression
  Scenario: Backspace removes last digit
    When I press "1", "2"
    And I press backspace
    And I press "3", "4", "5"
    Then 4 digits should be entered
    And the title should change to "Confirm your PIN"

  @regression
  Scenario: PIN is encrypted and stored
    When I enter PIN "1234"
    And I confirm PIN "1234"
    Then the encrypted key data should be stored
    And the pubkey should be stored for locked display
    And the npub should be stored for locked display
