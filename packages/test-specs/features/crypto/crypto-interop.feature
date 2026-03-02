@android @ios @crypto @regression
Feature: Crypto Interop with Test Vectors
  As a platform implementation
  I want to verify crypto operations against known test vectors
  So that all platforms produce compatible ciphertext

  Background:
    Given the test-vectors.json fixture is loaded

  Scenario: Key derivation matches test vectors
    Given the test secret key from vectors
    When I derive the public key
    Then it should match the expected public key in vectors

  Scenario: Note encryption roundtrip
    Given the test keypair from vectors
    When I encrypt a note with the test payload
    And I decrypt the note with the author envelope
    Then the decrypted plaintext should match the original

  Scenario: Note decryption with wrong key fails
    Given a note encrypted for the test author
    When I attempt to decrypt with the wrong secret key
    Then decryption should return null

  Scenario: Message encryption multi-reader roundtrip
    Given the volunteer and admin keypairs from vectors
    When I encrypt a message for both readers
    Then the volunteer can decrypt the message
    And the admin can decrypt the message
    And a third party with a wrong key cannot decrypt

  Scenario: PIN encryption matches format constraints
    Given the test PIN and nsec from vectors
    When I encrypt with the test PIN
    Then the salt length should be 32 hex characters
    And the nonce length should be 48 hex characters
    And the iterations should be 600,000
    And decryption with the same PIN should succeed

  @offline
  Scenario: Domain separation labels match protocol
    Given the label constants from vectors
    Then there should be exactly 28 label constants
    And the following labels should match:
      | constant             | expected_value              |
      | labelNoteKey         | llamenos:note-key           |
      | labelMessage         | llamenos:message            |
      | labelHubKeyWrap      | llamenos:hub-key-wrap       |
      | labelCallMeta        | llamenos:call-meta          |
      | labelFileKey         | llamenos:file-key           |
      | labelFileMetadata    | llamenos:file-metadata      |

  Scenario: Ephemeral keypair generation for device linking
    When I generate an ephemeral keypair
    Then both the secret and public key should be 64 hex characters
    And generating another keypair should produce different keys

  Scenario: SAS code derivation is deterministic
    Given a shared secret hex string
    When I derive the SAS code
    Then it should be exactly 6 digits
    And deriving again with the same secret should produce the same code
    And deriving with a different secret should produce a different code
