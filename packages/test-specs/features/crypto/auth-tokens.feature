@android @ios @crypto
Feature: Auth Token Creation
  As the app making API requests
  I want to create Schnorr auth tokens
  So that requests are authenticated without passwords

  Scenario: Auth token has correct structure
    Given I have a loaded keypair with known pubkey
    When I create an auth token for "GET" "/api/notes"
    Then the token should contain the pubkey
    And the token should contain a timestamp within the last minute
    And the token signature should be 128 hex characters

  Scenario: Auth token is unique per request
    Given I have a loaded keypair
    When I create a token for "GET" "/api/notes"
    And I create another token for "POST" "/api/notes"
    Then the two tokens should have different signatures
    And the two tokens should have different timestamps (unless same millisecond)

  Scenario: Locked crypto service cannot create tokens
    Given the crypto service is locked
    When I attempt to create an auth token
    Then it should throw a CryptoException
