@android @ios @smoke
Feature: PIN Unlock
  As a returning user
  I want to unlock the app with my PIN
  So that I can access my encrypted identity

  Background:
    Given I have a stored identity with PIN "1234"
    And the app is restarted

  Scenario: Unlock screen displays for returning user
    When the app launches
    Then I should see the PIN unlock screen
    And the title should indicate "Unlock"
    And the PIN pad should be displayed

  Scenario: Correct PIN unlocks the app
    When I enter PIN "1234"
    Then I should arrive at the dashboard
    And the crypto service should be unlocked

  Scenario: Wrong PIN shows error
    When I enter PIN "9999"
    Then I should see the error "Incorrect PIN"
    And I should remain on the unlock screen
    And the PIN dots should be cleared

  @regression
  Scenario: Multiple wrong PINs allow retry
    When I enter PIN "0000"
    And I see the error
    And I enter PIN "1111"
    And I see the error
    And I enter PIN "1234"
    Then I should arrive at the dashboard

  @regression
  Scenario: Reset identity from unlock screen
    When I tap "Reset Identity"
    Then I should see a confirmation dialog
    When I confirm the reset
    Then I should return to the login screen
    And no stored keys should remain
