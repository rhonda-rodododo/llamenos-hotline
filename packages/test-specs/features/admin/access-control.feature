@android @ios @regression
Feature: Access Control
  As the system
  I want to enforce state-based access to features
  So that locked devices cannot access sensitive functionality

  Scenario: Locked state restricts to PIN unlock only
    Given the crypto service is locked
    And a stored identity exists
    Then I should see the PIN unlock screen
    And the bottom navigation should not be visible
    And I should not be able to access any tab

  Scenario: Unlocked state provides full app access
    Given I am authenticated and on the dashboard
    Then the bottom navigation should be visible
    And I should be able to navigate to all tabs:
      | tab           |
      | Dashboard     |
      | Notes         |
      | Conversations |
      | Shifts        |
      | Settings      |

  Scenario: Crypto operations blocked when locked
    Given the crypto service is locked
    When I attempt to create an auth token
    Then it should throw a CryptoException
    When I attempt to encrypt a note
    Then it should throw a CryptoException
