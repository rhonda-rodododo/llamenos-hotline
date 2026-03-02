@android @ios @smoke @crypto
Feature: Keypair Generation
  As a user creating an identity
  I want the app to generate a valid Nostr keypair
  So that I have a cryptographically secure identity

  Scenario: Generated keypair has valid format
    When I generate a new keypair
    Then the nsec should start with "nsec1"
    And the npub should start with "npub1"
    And the nsec should be 63 characters long
    And the npub should be 63 characters long

  Scenario: Generated keypair is unique each time
    When I generate keypair A
    And I generate keypair B
    Then keypair A's nsec should differ from keypair B's nsec
    And keypair A's npub should differ from keypair B's npub

  Scenario: Public key is 64 hex characters
    When I generate a keypair
    Then the public key hex should be 64 characters
    And the public key should only contain hex characters [0-9a-f]

  Scenario: Keypair import roundtrip
    When I generate a keypair and get the nsec
    And I import that nsec into a fresh CryptoService
    Then the imported pubkey should match the original pubkey
    And the imported npub should match the original npub
