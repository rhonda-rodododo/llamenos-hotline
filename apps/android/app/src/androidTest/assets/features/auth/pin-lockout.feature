@android @ios @desktop @security
Feature: PIN Lockout
  As a security-conscious app
  I want to enforce escalating lockout after wrong PIN attempts
  So that brute-force PIN guessing is impractical

  Background:
    Given I have a stored identity with PIN "1234"
    And the app is restarted

  Scenario: First four wrong PINs allow immediate retry
    When I enter PIN "0000"
    Then I should see a PIN error message
    And I should not see a lockout timer
    When I enter PIN "1111"
    Then I should see a PIN error message
    And I should not see a lockout timer
    When I enter PIN "2222"
    Then I should see a PIN error message
    And I should not see a lockout timer
    When I enter PIN "3333"
    Then I should see a PIN error message
    And I should not see a lockout timer

  Scenario: Fifth wrong PIN triggers 30-second lockout
    Given I have 4 failed PIN attempts
    When I enter PIN "0000"
    Then I should see a lockout message
    And the lockout duration should be approximately 30 seconds
    And the PIN pad should be disabled

  Scenario: Seventh wrong PIN triggers 2-minute lockout
    Given I have 6 failed PIN attempts
    When I enter PIN "0000"
    Then I should see a lockout message
    And the lockout duration should be approximately 2 minutes
    And the PIN pad should be disabled

  Scenario: Ninth wrong PIN triggers 10-minute lockout
    Given I have 8 failed PIN attempts
    When I enter PIN "0000"
    Then I should see a lockout message
    And the lockout duration should be approximately 10 minutes

  @destructive
  Scenario: Tenth wrong PIN wipes all keys
    Given I have 9 failed PIN attempts
    When I enter PIN "0000"
    Then the stored keys should be wiped
    And I should be redirected to the setup or login screen

  Scenario: Correct PIN resets attempt counter
    Given I have 3 failed PIN attempts
    When I enter PIN "1234"
    Then I should arrive at the dashboard
    And the failed attempt counter should be reset

  Scenario: Lockout persists after app restart
    Given I have 5 failed PIN attempts
    And I see the lockout message
    When the app is restarted
    Then I should still see the lockout message
    And I should not be able to enter a PIN until lockout expires

  Scenario: After lockout expires, retry is allowed
    Given I have 5 failed PIN attempts
    And the lockout has expired
    When I enter PIN "1234"
    Then I should arrive at the dashboard
