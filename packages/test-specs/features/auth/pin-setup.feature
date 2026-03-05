@android @ios @desktop @smoke
Feature: PIN Setup
  As a user with a stored identity
  I want to use a PIN to unlock the app
  So that my private key is protected at rest

  Background:
    Given I have a stored identity with PIN "1234"
    And the app is restarted

  Scenario: PIN pad displays correctly
    Then I should see the PIN pad with digits 0-9
    And I should see the PIN dots indicator

  Scenario: Correct PIN unlocks to dashboard
    When I enter PIN "1234"
    Then I should arrive at the dashboard
    And the dashboard title should be displayed
    And the bottom navigation should be visible

  Scenario: Wrong PIN shows error
    When I enter PIN "9999"
    Then I should remain on the unlock screen
    And the PIN dots should be cleared

  @regression
  Scenario: Backspace removes entered digit
    When I press "1", "2"
    And I press backspace
    And I press "3", "4", "5"
    Then 4 digits should be entered

  @regression
  Scenario: PIN is encrypted and stored
    When I enter PIN "1234"
    Then the encrypted key data should be stored
    And the pubkey should be stored for locked display
    And the npub should be stored for locked display
